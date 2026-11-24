//! Keeps an "always on top" pet above fullscreen apps too, where it is a normal window (Windows, macOS
//! and X11). Tauri's always-on-top only covers ordinary windows there. On Wayland with layer-shell the
//! pet is on the overlay layer instead (`wayland.rs`).
//!
//! - X11: window managers put the focused fullscreen window above "keep above" ones, so the pet is
//!   made override-redirect, which they leave alone.
//! - Windows: a fullscreen app may be topmost as well, and the last one raised wins, so the pet is
//!   raised again while one is in front.
//! - macOS: the pet may join other apps' fullscreen spaces, above their windows (as in Electron).

use crate::{layer_pet, setting_bool, settings, wayland_session, window, Shared, PET_LABEL};
#[cfg(not(target_os = "macos"))]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(not(target_os = "macos"))]
use std::time::Duration;
use tauri::{AppHandle, WebviewWindow};

/// How often the pet's place above the window in front is checked (Windows, X11).
#[cfg(not(target_os = "macos"))]
const CHECK: Duration = Duration::from_millis(500);

/// Applies "always on top" to the pet, after Tauri's own. Safe to call again whenever settings change.
pub(crate) fn apply(app: &AppHandle, always_on_top: bool) {
	// On Wayland, no client can place itself above others except through layer-shell.
	if layer_pet() || wayland_session() {
		return;
	}
	let handle = app.clone();
	let _ = app.run_on_main_thread(move || {
		if let Some(pet) = window(&handle, PET_LABEL) {
			platform::apply(&pet, always_on_top);
		}
	});
}

#[cfg(target_os = "linux")]
mod platform {
	use super::*;
	use gtk::gdk;
	use gtk::glib::translate::{from_glib_full, ToGlibPtr};
	use gtk::prelude::*;
	use std::cell::RefCell;
	use tauri::Manager;

	/// How long a window manager gets to let go of the hidden pet. Shown again sooner, KWin keeps
	/// managing it as well, as a second, empty window.
	const WITHDRAW: Duration = Duration::from_millis(200);

	/// What the pet should be; it is hidden while it changes over.
	static OVERRIDE_REDIRECT: AtomicBool = AtomicBool::new(false);
	static CHANGING: AtomicBool = AtomicBool::new(false);

	pub fn apply(pet: &WebviewWindow, always_on_top: bool) {
		if OVERRIDE_REDIRECT.swap(always_on_top, Ordering::Relaxed) == always_on_top || CHANGING.swap(true, Ordering::Relaxed) {
			return;
		}
		let Ok(window) = pet.gtk_window() else { return };
		let (position, pet) = (window.position(), pet.clone());
		// Window managers only look at override-redirect when a window is mapped.
		let delay = if window.is_visible() { WITHDRAW } else { Duration::ZERO };
		window.hide();
		gtk::glib::timeout_add_local_once(delay, move || {
			CHANGING.store(false, Ordering::Relaxed);
			if let Some(surface) = window.window() {
				surface.set_override_redirect(OVERRIDE_REDIRECT.load(Ordering::Relaxed));
			}
			window.show_all();
			// Where it was asked to be, rather than where the window manager had put it.
			let saved = pet.try_state::<Shared>().map(|shared| settings(&shared)["petPosition"].clone()).unwrap_or_default();
			let (x, y) = match (saved["x"].as_f64(), saved["y"].as_f64()) {
				(Some(x), Some(y)) => (x.round() as i32, y.round() as i32),
				_ => position,
			};
			window.move_(x, y);
		});
	}

	/// The window manager's active window (`_NET_ACTIVE_WINDOW`), which the GTK crate does not wrap.
	fn active_window(screen: &gdk::Screen) -> Option<gdk::Window> {
		// SAFETY: a live screen; the returned window, if any, is owned by the caller.
		unsafe { from_glib_full(gdk::ffi::gdk_screen_get_active_window(screen.to_glib_none().0)) }
	}

	/// Window managers that do not stack override-redirect windows themselves raise what is activated
	/// above them. The pet is raised only when that happens, not constantly: menus, tooltips and
	/// screen lockers are override-redirect windows too and must stay above it.
	pub fn watch(app: &AppHandle) {
		let handle = app.clone();
		let _ = app.run_on_main_thread(move || {
			let last = RefCell::new(None);
			gtk::glib::timeout_add_local(CHECK, move || {
				if OVERRIDE_REDIRECT.load(Ordering::Relaxed) {
					let pet = window(&handle, PET_LABEL).and_then(|pet| pet.gtk_window().ok());
					if let Some(surface) = pet.and_then(|pet| pet.window()) {
						let active = active_window(&surface.screen());
						if *last.borrow() != active {
							surface.raise();
							last.replace(active);
						}
					}
				}
				gtk::glib::ControlFlow::Continue
			});
		});
	}
}

#[cfg(windows)]
mod platform {
	use super::*;
	use std::ffi::c_void;

	#[repr(C)]
	#[derive(Clone, Copy, Default)]
	struct Rect {
		left: i32,
		top: i32,
		right: i32,
		bottom: i32,
	}

	#[repr(C)]
	#[derive(Default)]
	struct MonitorInfo {
		size: u32,
		monitor: Rect,
		work: Rect,
		flags: u32,
	}

	#[link(name = "user32")]
	extern "system" {
		fn GetForegroundWindow() -> *mut c_void;
		fn GetWindowRect(window: *mut c_void, rect: *mut Rect) -> i32;
		fn MonitorFromWindow(window: *mut c_void, flags: u32) -> *mut c_void;
		fn GetMonitorInfoW(monitor: *mut c_void, info: *mut MonitorInfo) -> i32;
		fn SetWindowPos(window: *mut c_void, after: *mut c_void, x: i32, y: i32, width: i32, height: i32, flags: u32) -> i32;
	}

	const MONITOR_DEFAULT_TO_NEAREST: u32 = 2;
	const HWND_TOPMOST: isize = -1;
	/// SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_ASYNCWINDOWPOS
	const RAISE_ONLY: u32 = 0x0001 | 0x0002 | 0x0010 | 0x0200 | 0x4000;

	static ON_TOP: AtomicBool = AtomicBool::new(false);

	pub fn apply(pet: &WebviewWindow, always_on_top: bool) {
		ON_TOP.store(always_on_top, Ordering::Relaxed);
		if always_on_top {
			raise(pet);
		}
	}

	fn raise(pet: &WebviewWindow) {
		let Ok(handle) = pet.hwnd() else { return };
		// SAFETY: a window handle of this app; the call only changes its stacking.
		unsafe { SetWindowPos(handle.0 as *mut c_void, HWND_TOPMOST as *mut c_void, 0, 0, 0, 0, RAISE_ONLY) };
	}

	/// Whether `window` covers its whole screen (exclusive or borderless fullscreen).
	fn fullscreen(window: *mut c_void) -> bool {
		let mut rect = Rect::default();
		let mut info = MonitorInfo { size: std::mem::size_of::<MonitorInfo>() as u32, ..Default::default() };
		// SAFETY: valid out pointers; a stale window handle only makes the calls fail.
		let known = unsafe {
			GetWindowRect(window, &mut rect) != 0
				&& GetMonitorInfoW(MonitorFromWindow(window, MONITOR_DEFAULT_TO_NEAREST), &mut info) != 0
		};
		known
			&& rect.left <= info.monitor.left
			&& rect.top <= info.monitor.top
			&& rect.right >= info.monitor.right
			&& rect.bottom >= info.monitor.bottom
	}

	/// Raises the pet when another window comes to the front and while that one is fullscreen. Not
	/// otherwise: it would cover open menus and tooltips, which are topmost too.
	pub fn watch(app: &AppHandle) {
		let app = app.clone();
		std::thread::spawn(move || {
			let mut last = 0usize;
			loop {
				std::thread::sleep(CHECK);
				if !ON_TOP.load(Ordering::Relaxed) {
					continue;
				}
				// SAFETY: no arguments; may return null.
				let front = unsafe { GetForegroundWindow() };
				if front.is_null() || (front as usize == last && !fullscreen(front)) {
					continue;
				}
				last = front as usize;
				if let Some(pet) = window(&app, PET_LABEL) {
					raise(&pet);
				}
			}
		});
	}
}

#[cfg(target_os = "macos")]
mod platform {
	use super::*;
	use std::ffi::{c_char, c_void, CStr};

	#[link(name = "objc")]
	extern "C" {
		fn sel_registerName(name: *const c_char) -> *const c_void;
		fn objc_msgSend();
	}

	/// NSWindowCollectionBehavior: canJoinAllSpaces | fullScreenAuxiliary.
	const JOIN_FULLSCREEN_SPACES: usize = 1 << 0 | 1 << 8;
	/// Electron's "screen-saver" level, above fullscreen apps and the menu bar.
	const SCREEN_SAVER_LEVEL: isize = 1000;

	fn selector(name: &CStr) -> *const c_void {
		// SAFETY: a NUL-terminated selector name.
		unsafe { sel_registerName(name.as_ptr()) }
	}

	/// Main thread. When not on top, the level Tauri set (normal) stays.
	pub fn apply(pet: &WebviewWindow, always_on_top: bool) {
		let Ok(window) = pet.ns_window() else { return };
		// SAFETY: `window` is the pet's live NSWindow, used on the main thread, and each message is
		// sent with the types its NSWindow method is declared with.
		unsafe {
			let message = objc_msgSend as unsafe extern "C" fn();
			let get: extern "C" fn(*mut c_void, *const c_void) -> usize = std::mem::transmute(message);
			let set_behavior: extern "C" fn(*mut c_void, *const c_void, usize) = std::mem::transmute(message);
			let set_level: extern "C" fn(*mut c_void, *const c_void, isize) = std::mem::transmute(message);
			let behavior = get(window, selector(c"collectionBehavior"));
			set_behavior(window, selector(c"setCollectionBehavior:"), behavior | JOIN_FULLSCREEN_SPACES);
			if always_on_top {
				set_level(window, selector(c"setLevel:"), SCREEN_SAVER_LEVEL);
			}
		}
	}

	pub fn watch(_app: &AppHandle) {}
}

/// Applies the saved setting and starts watching for windows raised above the pet.
pub(crate) fn start(app: &AppHandle, shared: &Shared) {
	if layer_pet() || wayland_session() {
		return;
	}
	apply(app, setting_bool(&settings(shared), "alwaysOnTop", true));
	platform::watch(app);
}
