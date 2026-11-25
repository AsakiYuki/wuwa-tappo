//! Wuwa Tappo: the desktop pet and the studio (collection, draws, synthesis, presets, settings).
//!
//! The pages are Vue (src/renderer) and talk to this side through `window.petAPI` (`bridge.js`). The
//! game logic is TypeScript (src/domain), run in QuickJS (`backend.rs`); the Rust side owns windows
//! (`pet.rs`, `studio.rs`), input (`input.rs`), the tray (`tray.rs`) and saving (`storage.rs`, here).
//!
//! Input: rdev (keyboard/mouse hook) on Windows and Linux, a CGEventTap on macOS (`macos_input.rs`),
//! evdev on Linux (also works on Wayland, and reads controllers), and the controller watchers on
//! Windows (XInput) and macOS (IOKit) (`gamepad.rs`).
//!
//! Linux runs natively on Wayland when available: the pet is then a layer-shell surface
//! (`wayland.rs`), since Wayland windows cannot place themselves or stay on top.
//!
//! Hover-fade with passthrough on Wayland works on KDE only (`kwin_cursor.rs`):
//! Wayland gives apps no global cursor position.

mod autostart;
mod backend;
mod commands;
#[cfg(target_os = "linux")]
mod evdev;
mod gamepad;
mod input;
mod keys;
#[cfg(target_os = "linux")]
mod kwin_cursor;
#[cfg(target_os = "linux")]
mod linux_input_access;
#[cfg(target_os = "linux")]
mod linux_tray;
#[cfg(target_os = "macos")]
mod macos_input;
mod online;
mod overlay;
mod pet;
mod storage;
mod studio;
mod tray;
#[cfg(target_os = "linux")]
mod wayland;

use backend::Backend;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use storage::Store;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WebviewWindow};

pub(crate) const PET_LABEL: &str = "pet";
pub(crate) const STUDIO_LABEL: &str = "studio";
const BRIDGE_JS: &str = include_str!("../bridge.js");
pub(crate) const CATALOG_JSON: &str = include_str!("../../assets/catalog.json");
/// Frequent changes (taps, dragging) are coalesced into one save this much later.
const DEFERRED_SAVE: Duration = Duration::from_secs(3);
pub(crate) const SAVE_FAILED: &str = "Failed to save collection, please check folder permissions";

/// Which raw input devices evdev has open (Linux). While one is, the rdev hook's events of the same
/// kind are ignored, since evdev already reports them.
#[derive(Default)]
pub struct InputDevices {
	pub keyboard: AtomicBool,
	pub mouse: AtomicBool,
}

/// Everything the app tracks besides the collection itself, which lives in the backend.
pub(crate) struct AppState {
	/// Copy of the backend's settings, read on every input event and cursor poll.
	pub settings: Value,
	/// Equipped emotes, for the Ctrl/Meta+Alt+1…5 shortcuts.
	pub emotes: Vec<String>,
	pub counts: (Value, Value, Value),
	pub pressed: HashSet<String>,
	pub serial: u64,
	/// The pet's visible content, as reported by its page; hover-fade hit-tests the cursor against it.
	pub hover_area: Option<pet::HoverArea>,
	/// Hover-fade's cursor feed to the pet page (`pet::feed_cursor`).
	pub cursor: pet::CursorFeed,
	/// Set when the global input hook stopped with an error.
	pub hook_error: Option<String>,
	pub save_warning: String,
	pub studio: studio::StudioState,
}

pub struct Core {
	pub(crate) state: Mutex<AppState>,
	pub(crate) backend: Mutex<Backend>,
	pub(crate) store: Store,
	pub(crate) online: online::Online,
	save_scheduled: AtomicBool,
	pub(crate) devices: Arc<InputDevices>,
}

pub type Shared = Arc<Core>;

pub(crate) fn setting_bool(settings: &Value, key: &str, default: bool) -> bool {
	settings[key].as_bool().unwrap_or(default)
}

pub(crate) fn setting_f64(settings: &Value, key: &str, default: f64) -> f64 {
	settings[key].as_f64().unwrap_or(default)
}

pub(crate) fn settings(shared: &Shared) -> Value {
	shared.state.lock().unwrap().settings.clone()
}

pub(crate) fn window(app: &AppHandle, label: &str) -> Option<WebviewWindow> {
	app.get_webview_window(label)
}

/// A pointer delta from a page (CSS pixels) in physical pixels. Deltas beyond any screen are
/// clamped, so window arithmetic on them cannot overflow `i32`.
pub(crate) fn pointer_delta(css_pixels: f64, scale: f64) -> i32 {
	const MAX_CSS_PIXELS: f64 = 100_000.0;
	(css_pixels.clamp(-MAX_CSS_PIXELS, MAX_CSS_PIXELS) * scale).round() as i32
}

/// A native Wayland session (not XWayland).
pub(crate) fn wayland_session() -> bool {
	#[cfg(target_os = "linux")]
	return wayland::session();
	#[cfg(not(target_os = "linux"))]
	false
}

/// The pet is a Wayland layer surface: placed by margins, not window positions.
pub(crate) fn layer_pet() -> bool {
	#[cfg(target_os = "linux")]
	return wayland::layer_shell();
	#[cfg(not(target_os = "linux"))]
	false
}

/// Scripts injected into every page: whether native Wayland behaviour applies, then the bridge.
pub(crate) fn page_scripts() -> String {
	format!("window.__WUWA_WAYLAND__ = {};\n{BRIDGE_JS}", wayland_session())
}

/* ------------------------------ state & saving ------------------------------ */

/// Re-reads what Rust caches from the backend after the state changed.
pub(crate) fn refresh_cache(shared: &Shared) -> Value {
	let state = shared.backend.lock().unwrap().state();
	let mut app_state = shared.state.lock().unwrap();
	app_state.settings = state["settings"].clone();
	app_state.emotes = state["emotes"]
		.as_array()
		.map(|ids| ids.iter().filter_map(|id| id.as_str().map(String::from)).collect())
		.unwrap_or_default();
	app_state.counts = (state["count"].clone(), state["totalCount"].clone(), state["dailyCount"].clone());
	state
}

pub(crate) fn broadcast_state(app: &AppHandle, state: &Value) {
	let _ = app.emit("state", state);
}

pub(crate) fn status(shared: &Shared) -> Value {
	let warning = shared.state.lock().unwrap().save_warning.clone();
	json!({ "hook": input::hook_status(shared), "warning": warning })
}

pub(crate) fn broadcast_status(app: &AppHandle, shared: &Shared) {
	let _ = app.emit("status", status(shared));
}

pub(crate) fn save_now(app: &AppHandle, shared: &Shared) -> bool {
	let content = shared.backend.lock().unwrap().save_json();
	match shared.store.save(&content) {
		Ok(()) => true,
		Err(error) => {
			eprintln!("save: {error}");
			shared.state.lock().unwrap().save_warning = SAVE_FAILED.into();
			broadcast_status(app, shared);
			false
		}
	}
}

/// Coalesces frequent changes (taps, dragging) into one save a few seconds later.
pub(crate) fn save_later(app: &AppHandle, shared: &Shared) {
	if shared.save_scheduled.swap(true, Ordering::SeqCst) {
		return;
	}
	let (app, shared) = (app.clone(), shared.clone());
	std::thread::spawn(move || {
		std::thread::sleep(DEFERRED_SAVE);
		shared.save_scheduled.store(false, Ordering::SeqCst);
		save_now(&app, &shared);
	});
}

/// Receives `wuwa-buddy://` links: the one that launched this copy, and later ones (macOS delivers
/// them as events; Windows and Linux start a second copy, which the single-instance plugin forwards).
fn login_links(app: &AppHandle, shared: &Shared) {
	use tauri_plugin_deep_link::DeepLinkExt;
	let links = app.deep_link();
	// Windows and Linux installs register the scheme themselves; this also covers a build run from source.
	#[cfg(any(windows, target_os = "linux"))]
	if let Err(error) = links.register(online::LOGIN_SCHEME) {
		eprintln!("online: could not register the {} link: {error}", online::LOGIN_SCHEME);
	}
	let (handle, state) = (app.clone(), shared.clone());
	links.on_open_url(move |event| {
		for url in event.urls() {
			online::handle_login_url(&handle, &state, url.as_str());
		}
	});
	if let Ok(Some(urls)) = links.get_current() {
		for url in urls {
			online::handle_login_url(app, shared, url.as_str());
		}
	}
}

/* ---------------------------------- run ---------------------------------- */

pub fn run() {
	let app = tauri::Builder::default()
		// Must be the first plugin. A second launch brings this one's pet and studio forward
		// instead of running a second copy that would overwrite the same save.
		.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
			if let Some(shared) = app.try_state::<Shared>() {
				let shared = shared.inner().clone();
				// A login callback also arrives as an argument of the second launch (Windows, Linux).
				if let Some(url) = args.iter().find(|argument| argument.starts_with(online::LOGIN_SCHEME)) {
					online::handle_login_url(app, &shared, url);
					return;
				}
				pet::show(app);
				studio::show(app, &shared, None);
			}
		}))
		.plugin(tauri_plugin_deep_link::init())
		.plugin(tauri_plugin_dialog::init())
		.invoke_handler(tauri::generate_handler![
			commands::init,
			commands::command,
			online::online_request,
			online::online_status,
			online::online_login_start,
			online::online_login_choose,
			online::online_login_switch,
			online::online_room_connect,
			online::online_room_leave,
			online::online_room_changed,
			online::online_room_show_member,
			online::online_room_snapshot,
			online::online_room_looks,
			online::online_room_member,
			online::online_login_cancel,
			pet::move_pet,
			pet::end_pet_drag,
			pet::set_hover_area,
			studio::resize_studio_edge
		])
		.setup(|app| {
			#[cfg(target_os = "linux")]
			wayland::detect();
			// macOS: a menu-bar app, like the pet's skip_taskbar elsewhere: no Dock icon and no app
			// menu; the tray opens the studio.
			#[cfg(target_os = "macos")]
			app.set_activation_policy(tauri::ActivationPolicy::Accessory);
			let backend = Backend::new(CATALOG_JSON)?;
			let store = Store::new().ok_or("no config directory")?;
			let warning = store.load(&backend);
			let shared: Shared = Arc::new(Core {
				state: Mutex::new(AppState {
					settings: Value::Null,
					emotes: Vec::new(),
					counts: (Value::Null, Value::Null, Value::Null),
					pressed: HashSet::new(),
					serial: 0,
					hover_area: None,
					cursor: pet::CursorFeed::default(),
					hook_error: None,
					save_warning: warning,
					studio: studio::StudioState::default(),
				}),
				backend: Mutex::new(backend),
				online: online::Online::new(store.directory()),
				store,
				save_scheduled: AtomicBool::new(false),
				devices: Arc::new(InputDevices::default()),
			});
			refresh_cache(&shared);
			// Keep the login entry pointing at this copy of the app (it may have moved or updated).
			autostart::refresh(setting_bool(&shared.state.lock().unwrap().settings, "autoStart", false));
			app.manage(shared.clone());

			let handle = app.handle().clone();
			save_now(&handle, &shared);
			pet::create(&handle, &shared)?;
			overlay::start(&handle, &shared);
			tray::create(&handle, &shared)?;
			input::start(&handle, &shared);
			online::start_chests(&handle, &shared);
			// A fresh profile opens the studio.
			let state = shared.backend.lock().unwrap().state();
			let first_run =
				state["draws"] == json!(0) && state["presets"].as_array().is_none_or(|presets| presets.is_empty());
			if first_run || std::env::args().any(|argument| argument == "--studio") {
				studio::show(&handle, &shared, None);
			}
			pet::start_cursor_feed(&handle, &shared);
			login_links(&handle, &shared);
			Ok(())
		})
		.build(tauri::generate_context!())
		.expect("error while building Wuwa Tappo");

	app.run(|app, event| {
		// Closing the studio does not quit: the app keeps running until "Exit".
		if let RunEvent::ExitRequested { code: None, api, .. } = &event {
			api.prevent_exit();
		}
		if let RunEvent::Exit = event {
			#[cfg(target_os = "linux")]
			kwin_cursor::stop();
			if let Some(shared) = app.try_state::<Shared>() {
				save_now(app, &shared);
			}
		}
	});
}

#[cfg(test)]
mod tests {
	use super::pointer_delta;

	#[test]
	fn pointer_deltas_are_clamped_so_window_arithmetic_cannot_overflow() {
		assert_eq!(pointer_delta(3.4, 2.0), 7);
		assert_eq!(pointer_delta(1e300, 2.0), 200_000);
		assert_eq!(pointer_delta(-f64::MAX, 4.0), -400_000);
		// The studio's edge resize adds and subtracts these from i32 coordinates.
		assert!(i32::MAX.checked_sub(pointer_delta(-1e300, 4.0)).is_none());
		assert_eq!(i32::MAX.saturating_sub(pointer_delta(-1e300, 4.0)), i32::MAX);
	}
}
