//! Tauri port of Wuwa Tappo: the desktop pet and the studio (collection, draws, synthesis, presets,
//! settings), with the same Vue renderer as the Electron app.
//!
//! `bridge.js` re-creates Electron's `window.petAPI` on Tauri's IPC, so the pages run unchanged.
//! The game logic is the Electron app's own TypeScript, run in QuickJS (`backend.rs`); this file
//! owns windows, input, the tray and saving. The save is the Electron app's collection.json, so both
//! apps share one collection (run only one of them at a time).
//!
//! Input: rdev (keyboard/mouse hook) on Windows and Linux, a CGEventTap on macOS (`macos_input.rs`),
//! evdev on Linux (also works on Wayland, and reads controllers), and the controller watchers on
//! Windows (XInput) and macOS (IOKit) (`gamepad.rs`).
//!
//! Linux runs natively on Wayland when available: the pet is then a layer-shell surface
//! (`wayland.rs`), since Wayland windows cannot place themselves or stay on top.
//!
//! Not ported: autostart. Hover-fade with passthrough on Wayland works on KDE only (`kwin_cursor.rs`):
//! Wayland gives apps no global cursor position.

mod backend;
#[cfg(target_os = "linux")]
mod evdev;
mod gamepad;
mod keys;
#[cfg(target_os = "linux")]
mod kwin_cursor;
#[cfg(target_os = "linux")]
mod linux_tray;
#[cfg(target_os = "macos")]
mod macos_input;
mod storage;
#[cfg(target_os = "linux")]
mod wayland;

use backend::Backend;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use storage::Store;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::PageLoadEvent;
use tauri::{
	AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize, RunEvent,
	WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_dialog::DialogExt;

const PET_LABEL: &str = "pet";
const STUDIO_LABEL: &str = "studio";
const BRIDGE_JS: &str = include_str!("../bridge.js");
const CATALOG_JSON: &str = include_str!("../../assets/catalog.json");
/// Window sizes match src/node/window-manager.ts.
const PET_SIZE_KEYBOARD: (f64, f64) = (320.0, 350.0);
const PET_SIZE_COMPACT: (f64, f64) = (225.0, 215.0);
const PET_CORNER_MARGIN: (f64, f64) = (24.0, 12.0);
const STUDIO_SIZE: (f64, f64) = (1100.0, 756.0);
const STUDIO_MIN_SIZE: (f64, f64) = (680.0, 468.0);
const STUDIO_ZOOM_STEP: f64 = 1.1;
/// Delay before navigating a studio that has just loaded, as in src/node/commands.ts.
const NAVIGATE_AFTER_LOAD: Duration = Duration::from_millis(300);
const CURSOR_POLL: Duration = Duration::from_millis(80);
/// Frequent changes (taps, dragging) are coalesced into one save this much later.
const DEFERRED_SAVE: Duration = Duration::from_secs(3);
const TRAY_ID: &str = "main";
/// The pet window may only open the studio, play emotes and report clicks (src/node/main.ts).
const PET_COMMANDS: [&str; 3] = ["tap", "emote", "open"];
const SAVE_FAILED: &str = "Failed to save collection, please check folder permissions";

#[derive(Clone, Copy, Deserialize)]
struct HoverArea {
	left: f64,
	top: f64,
	right: f64,
	bottom: f64,
}

/// Which raw input devices evdev has open (Linux). While one is, the rdev hook's events of the same
/// kind are ignored, since evdev already reports them.
#[derive(Default)]
pub struct InputDevices {
	pub keyboard: AtomicBool,
	pub mouse: AtomicBool,
}

/// Everything the app tracks besides the collection itself, which lives in the backend.
struct Pet {
	/// Copy of the backend's settings, read on every input event and cursor poll.
	settings: Value,
	/// Equipped emotes, for the Ctrl/Meta+Alt+1…5 shortcuts.
	emotes: Vec<String>,
	counts: (Value, Value, Value),
	pressed: HashSet<String>,
	serial: u64,
	/// Reported by the renderer; Electron uses it for KWin's hover-fade (here the page hit-tests).
	#[allow(dead_code)]
	hover_area: Option<HoverArea>,
	tracking_cursor: bool,
	/// Set when the rdev hook stopped with an error.
	hook_error: Option<String>,
	save_warning: String,
	studio_loaded: bool,
	/// A page the studio should open once it has loaded.
	pending_page: Option<String>,
	/// Bounds to restore when the studio's "maximize" is toggled off.
	studio_restore: Option<(PhysicalPosition<i32>, PhysicalSize<u32>)>,
}

pub struct Core {
	pet: Mutex<Pet>,
	backend: Mutex<Backend>,
	store: Store,
	save_scheduled: AtomicBool,
	devices: Arc<InputDevices>,
}

pub type Shared = Arc<Core>;

fn setting_bool(settings: &Value, key: &str, default: bool) -> bool {
	settings[key].as_bool().unwrap_or(default)
}

fn setting_f64(settings: &Value, key: &str, default: f64) -> f64 {
	settings[key].as_f64().unwrap_or(default)
}

fn settings(shared: &Shared) -> Value {
	shared.pet.lock().unwrap().settings.clone()
}

fn window(app: &AppHandle, label: &str) -> Option<WebviewWindow> {
	app.get_webview_window(label)
}

/// A native Wayland session (not XWayland).
fn wayland_session() -> bool {
	#[cfg(target_os = "linux")]
	return wayland::session();
	#[cfg(not(target_os = "linux"))]
	false
}

/// The pet is a Wayland layer surface: placed by margins, not window positions.
fn layer_pet() -> bool {
	#[cfg(target_os = "linux")]
	return wayland::layer_shell();
	#[cfg(not(target_os = "linux"))]
	false
}

/// Scripts injected into every page: whether native Wayland behaviour applies, then the bridge.
fn page_scripts() -> String {
	format!("window.__WUWA_WAYLAND__ = {};\n{BRIDGE_JS}", wayland_session())
}

/* ------------------------------ state & saving ------------------------------ */

/// Re-reads what Rust caches from the backend after the state changed.
fn refresh_cache(shared: &Shared) -> Value {
	let state = shared.backend.lock().unwrap().state();
	let mut pet = shared.pet.lock().unwrap();
	pet.settings = state["settings"].clone();
	pet.emotes = state["emotes"]
		.as_array()
		.map(|ids| ids.iter().filter_map(|id| id.as_str().map(String::from)).collect())
		.unwrap_or_default();
	pet.counts = (state["count"].clone(), state["totalCount"].clone(), state["dailyCount"].clone());
	state
}

fn broadcast_state(app: &AppHandle, state: &Value) {
	let _ = app.emit("state", state);
}

/// Same wording as the Electron app's input status (src/node/input-manager.ts).
fn hook_status(shared: &Shared) -> String {
	if shared.devices.keyboard.load(Ordering::Relaxed) {
		return "Global input connected (evdev)".into();
	}
	if needs_input_access() {
		return "Wayland: Input permission required (tray menu → Fix Input Permissions)".into();
	}
	match &shared.pet.lock().unwrap().hook_error {
		Some(error) => error.clone(),
		None if cfg!(target_os = "macos") => "Global input connected (macOS)".into(),
		None => "Global input connected (rdev)".into(),
	}
}

/// On Wayland the X11 hook only sees keys typed into XWayland windows, so global input needs evdev,
/// i.e. read access to the keyboard devices.
fn needs_input_access() -> bool {
	cfg!(target_os = "linux") && std::env::var_os("WAYLAND_DISPLAY").is_some()
}

fn status(shared: &Shared) -> Value {
	let warning = shared.pet.lock().unwrap().save_warning.clone();
	json!({ "hook": hook_status(shared), "warning": warning })
}

fn broadcast_status(app: &AppHandle, shared: &Shared) {
	let _ = app.emit("status", status(shared));
}

fn save_now(app: &AppHandle, shared: &Shared) -> bool {
	let content = shared.backend.lock().unwrap().state_json();
	match shared.store.save(&content) {
		Ok(()) => true,
		Err(error) => {
			eprintln!("save: {error}");
			shared.pet.lock().unwrap().save_warning = SAVE_FAILED.into();
			broadcast_status(app, shared);
			false
		}
	}
}

/// Coalesces frequent changes (taps, dragging) into one save a few seconds later.
fn save_later(app: &AppHandle, shared: &Shared) {
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

/* ------------------------------- pet window ------------------------------- */

/// Pet window size in logical pixels for the current settings.
fn pet_size(settings: &Value) -> (f64, f64) {
	let scale = setting_f64(settings, "scale", 1.0);
	let (width, height) =
		if setting_bool(settings, "showKeyboard", true) { PET_SIZE_KEYBOARD } else { PET_SIZE_COMPACT };
	((width * scale).round(), (height * scale).round())
}

/// The screen chosen in settings (F8 / "Cycle Screen"), else the primary one.
fn active_monitor(app: &AppHandle, settings: &Value) -> Option<tauri::Monitor> {
	let index = settings["monitor"].as_u64().unwrap_or(0) as usize;
	let monitors = app.available_monitors().unwrap_or_default();
	monitors.into_iter().nth(index).or_else(|| app.primary_monitor().ok().flatten())
}

/// Bottom-right corner of the active screen's work area.
fn corner_position(app: &AppHandle, settings: &Value, (width, height): (f64, f64)) -> LogicalPosition<f64> {
	let Some(monitor) = active_monitor(app, settings) else { return LogicalPosition::new(0.0, 0.0) };
	let area = monitor.work_area().size.to_logical::<f64>(monitor.scale_factor());
	let origin = monitor.work_area().position.to_logical::<f64>(monitor.scale_factor());
	LogicalPosition::new(
		origin.x + area.width - width - PET_CORNER_MARGIN.0,
		origin.y + area.height - height - PET_CORNER_MARGIN.1,
	)
}

/// Where the pet goes: its saved spot, or the corner (always, when `reset`).
fn pet_position(app: &AppHandle, settings: &Value, size: (f64, f64), reset: bool) -> LogicalPosition<f64> {
	let saved = &settings["petPosition"];
	match (saved["x"].as_f64(), saved["y"].as_f64()) {
		(Some(x), Some(y)) if !reset => LogicalPosition::new(x, y),
		_ => corner_position(app, settings, size),
	}
}

fn create_pet_window(app: &AppHandle, shared: &Shared) -> tauri::Result<WebviewWindow> {
	let settings = settings(shared);
	let (width, height) = pet_size(&settings);
	let position = pet_position(app, &settings, (width, height), false);
	let window = WebviewWindowBuilder::new(app, PET_LABEL, WebviewUrl::App("web/pet.html".into()))
		.title("Wuwa Tappo")
		.inner_size(width, height)
		.position(position.x, position.y)
		.transparent(true)
		.decorations(false)
		.shadow(false)
		.resizable(false)
		.skip_taskbar(true)
		.always_on_top(setting_bool(&settings, "alwaysOnTop", true))
		.visible_on_all_workspaces(true)
		.focused(false)
		// macOS: the first click on the (never focused) pet reaches the page instead of only
		// activating the window, so it can be dragged and tapped right away.
		.accept_first_mouse(true)
		// On Wayland it must stay unmapped until it has become a layer surface. Elsewhere it is shown
		// at once: a window created hidden keeps a stale position in Tauri on X11.
		.visible(!wayland_session())
		.initialization_script(page_scripts())
		.build()?;
	#[cfg(target_os = "linux")]
	if wayland_session() {
		if wayland::init_pet(&window, (width, height)) {
			place_pet(app, shared, false);
			wayland::set_passthrough(app, setting_bool(&settings, "passthrough", false));
			wayland::show(app);
			return Ok(window);
		}
		window.show()?;
	}
	let _ = window.set_size(LogicalSize::new(width, height));
	window.set_ignore_cursor_events(setting_bool(&settings, "passthrough", false))?;
	Ok(window)
}

/// Sizes the pet for the current settings and moves it to its saved spot or the corner.
fn place_pet(app: &AppHandle, shared: &Shared, reset: bool) {
	let Some(window) = window(app, PET_LABEL) else { return };
	let settings = settings(shared);
	let size = pet_size(&settings);
	#[cfg(target_os = "linux")]
	if layer_pet() {
		let Some(monitor) = active_monitor(app, &settings) else { return };
		let saved = &settings["petPosition"];
		let saved = saved["x"].as_f64().zip(saved["y"].as_f64()).filter(|_| !reset);
		let index = settings["monitor"].as_u64().unwrap_or(0) as usize;
		let margins = wayland::margins_for(saved, &monitor, size);
		wayland::place(app, index, setting_bool(&settings, "alwaysOnTop", true), size, margins);
		let (x, y) = wayland::saved_position(&monitor, size);
		shared.backend.lock().unwrap().set_pet_position(x, y);
		refresh_cache(shared);
		return;
	}
	let _ = window.set_size(LogicalSize::new(size.0, size.1));
	let position = pet_position(app, &settings, size, reset);
	let _ = window.set_position(position);
	shared.backend.lock().unwrap().set_pet_position(position.x, position.y);
	refresh_cache(shared);
}

/// Applies window-level settings to the pet; `previous` tells what changed.
fn apply_settings(app: &AppHandle, shared: &Shared, previous: Option<&Value>) {
	let settings = settings(shared);
	if let Some(window) = window(app, PET_LABEL) {
		#[cfg(target_os = "linux")]
		let layer = layer_pet();
		#[cfg(not(target_os = "linux"))]
		let layer = false;
		if layer {
			#[cfg(target_os = "linux")]
			wayland::set_passthrough(app, setting_bool(&settings, "passthrough", false));
		} else {
			let _ = window.set_always_on_top(setting_bool(&settings, "alwaysOnTop", true));
			let _ = window.set_ignore_cursor_events(setting_bool(&settings, "passthrough", false));
		}
		let changed = |key: &str| previous.is_some_and(|previous| previous[key] != settings[key]);
		// The keyboard is laid out at load, so toggling it reloads the page (like Electron).
		if changed("showKeyboard") {
			let _ = window.reload();
		}
		// A layer surface's layer (overlay or below windows) follows "always on top".
		if changed("showKeyboard") || changed("scale") || changed("monitor") || layer_pet() {
			place_pet(app, shared, changed("monitor"));
		}
	}
	shared.pet.lock().unwrap().pressed.clear();
	refresh_tray(app, shared);
}

/// Shows the pet (on Wayland it may live in a layer-surface window that Tauri does not know).
fn show_pet(app: &AppHandle) {
	#[cfg(target_os = "linux")]
	if layer_pet() {
		return wayland::show(app);
	}
	if let Some(window) = window(app, PET_LABEL) {
		let _ = window.show();
	}
}

/// Shows the pet again and moves it back to the screen corner (it may have been dragged off-screen).
fn reset_pet(app: &AppHandle, shared: &Shared) {
	show_pet(app);
	place_pet(app, shared, true);
	save_now(app, shared);
	broadcast_state(app, &refresh_cache(shared));
}

/// Changes a boolean setting from the tray, saves it and syncs every window.
fn toggle_setting(app: &AppHandle, shared: &Shared, key: &str) {
	let enabled = !setting_bool(&settings(shared), key, key == "inputEnabled");
	let reply = shared.backend.lock().unwrap().command("settings", &json!({ key: enabled }));
	finish_state_command(app, shared, "settings", &reply);
}

/// Click-through windows get no hover events, so hover-fade is fed the cursor position instead.
fn poll_cursor(app: AppHandle, shared: Shared) {
	loop {
		std::thread::sleep(CURSOR_POLL);
		let Some(window) = window(&app, PET_LABEL) else { continue };
		// No lock is held while asking the window: on Linux that waits for the main thread, which may
		// itself be waiting for the lock.
		let settings = settings(&shared);
		let hover_fade = setting_bool(&settings, "hoverFade", true);
		let wanted = setting_bool(&settings, "passthrough", false) && hover_fade;
		// Wayland gives apps no global cursor position: on KDE, KWin sends it (kwin_cursor), for the
		// layer-surface pet, whose position the app knows. It is used even without passthrough, since
		// WebKitGTK sometimes misses the pointer leaving a layer surface and `:hover` sticks.
		#[cfg(target_os = "linux")]
		if wayland_session() {
			let wanted = hover_fade && layer_pet();
			kwin_cursor::set_active(wanted || kwin_cursor::dragging());
			if !wanted && std::mem::take(&mut shared.pet.lock().unwrap().tracking_cursor) {
				let _ = app.emit_to(PET_LABEL, "cursor", Value::Null);
			}
			continue;
		}
		if wanted {
			let (Ok(cursor), Ok(origin), Ok(scale)) =
				(window.cursor_position(), window.inner_position(), window.scale_factor())
			else {
				continue;
			};
			let message = json!({
				"x": (cursor.x - origin.x as f64) / scale,
				"y": (cursor.y - origin.y as f64) / scale,
			});
			shared.pet.lock().unwrap().tracking_cursor = true;
			let _ = app.emit_to(PET_LABEL, "cursor", message);
		} else if std::mem::take(&mut shared.pet.lock().unwrap().tracking_cursor) {
			let _ = app.emit_to(PET_LABEL, "cursor", Value::Null);
		}
	}
}

/* ------------------------------ studio window ------------------------------ */

type Bounds = (PhysicalPosition<i32>, PhysicalSize<u32>);

/// Clamps studio bounds to the minimum size and keeps the window on its screen.
fn fit_studio(monitor: &tauri::Monitor, (position, size): Bounds) -> Bounds {
	let area = monitor.work_area();
	let scale = monitor.scale_factor();
	let (area_width, area_height) = (area.size.width as f64, area.size.height as f64);
	let min_width = (STUDIO_MIN_SIZE.0 * scale).min(area_width);
	let min_height = (STUDIO_MIN_SIZE.1 * scale).min(area_height);
	let width = (size.width as f64).min(area_width).max(min_width).round();
	let height = (size.height as f64).min(area_height).max(min_height).round();
	let x = (position.x as f64).min(area.position.x as f64 + area_width - width).max(area.position.x as f64);
	let y = (position.y as f64).min(area.position.y as f64 + area_height - height).max(area.position.y as f64);
	(PhysicalPosition::new(x.round() as i32, y.round() as i32), PhysicalSize::new(width as u32, height as u32))
}

fn studio_bounds(studio: &WebviewWindow) -> Option<(tauri::Monitor, Bounds)> {
	// Wayland does not always tell which screen a window is on.
	let monitor = studio.current_monitor().ok().flatten().or_else(|| studio.primary_monitor().ok().flatten())?;
	Some((monitor, (studio.outer_position().ok()?, studio.outer_size().ok()?)))
}

fn set_bounds(window: &WebviewWindow, (position, size): Bounds) {
	let _ = window.set_size(size);
	let _ = window.set_position(position);
}

fn navigate_studio(app: &AppHandle, page: String) {
	let _ = app.emit_to(STUDIO_LABEL, "page", page);
}

/// Shows the studio, creating it on first use; closing it only hides it. Opens `page` if given.
fn show_studio(app: &AppHandle, shared: &Shared, page: Option<String>) {
	if let Some(studio) = window(app, STUDIO_LABEL) {
		let _ = studio.unminimize();
		if let Some((monitor, bounds)) = studio_bounds(&studio) {
			set_bounds(&studio, fit_studio(&monitor, bounds));
		}
		let _ = studio.show();
		let _ = studio.set_focus();
		let loaded = {
			let mut pet = shared.pet.lock().unwrap();
			if !pet.studio_loaded && page.is_some() {
				pet.pending_page = page.clone();
			}
			pet.studio_loaded
		};
		if let (true, Some(page)) = (loaded, page) {
			navigate_studio(app, page);
		}
		return;
	}

	shared.pet.lock().unwrap().pending_page = page;
	let area = app
		.primary_monitor()
		.ok()
		.flatten()
		.map(|monitor| monitor.work_area().size.to_logical::<f64>(monitor.scale_factor()))
		.unwrap_or(LogicalSize::new(STUDIO_SIZE.0, STUDIO_SIZE.1));
	let page_shared = shared.clone();
	let built = WebviewWindowBuilder::new(app, STUDIO_LABEL, WebviewUrl::App("web/studio.html".into()))
		.title("Wuwa Tappo · Studio & Collection")
		.inner_size(STUDIO_SIZE.0.min(area.width - 50.0), STUDIO_SIZE.1.min(area.height - 50.0))
		.min_inner_size(STUDIO_MIN_SIZE.0.min(area.width), STUDIO_MIN_SIZE.1.min(area.height))
		.center()
		.decorations(false)
		.transparent(true)
		.resizable(true)
		.accept_first_mouse(true)
		// Shown right away: it is transparent, so nothing shows before the page paints. A window
		// created hidden keeps a stale 1×1 size and position in Tauri on Linux/X11, which breaks
		// maximize/restore and the zoom buttons.
		.initialization_script(page_scripts())
		.on_page_load(move |studio, payload| {
			if payload.event() != PageLoadEvent::Finished {
				return;
			}
			let page = {
				let mut pet = page_shared.pet.lock().unwrap();
				pet.studio_loaded = true;
				pet.pending_page.take()
			};
			let _ = studio.set_focus();
			if let Some(page) = page {
				let app = studio.app_handle().clone();
				std::thread::spawn(move || {
					std::thread::sleep(NAVIGATE_AFTER_LOAD);
					navigate_studio(&app, page);
				});
			}
		})
		.build();
	match built {
		Ok(studio) => {
			let hidden = studio.clone();
			studio.on_window_event(move |event| {
				if let WindowEvent::CloseRequested { api, .. } = event {
					api.prevent_close();
					let _ = hidden.hide();
				}
			});
		}
		Err(error) => eprintln!("studio: {error}"),
	}
}

/// The studio's own title-bar buttons: minimize, maximize/restore, smaller, larger.
fn resize_studio(app: &AppHandle, shared: &Shared, action: &str) {
	let Some(studio) = window(app, STUDIO_LABEL) else { return };
	let Some((monitor, (position, size))) = studio_bounds(&studio) else { return };
	match action {
		"minimize" => {
			let _ = studio.minimize();
		}
		// Wayland windows cannot place themselves, so the compositor maximizes and restores.
		"maximize" if wayland_session() => {
			let _ = if studio.is_maximized().unwrap_or(false) { studio.unmaximize() } else { studio.maximize() };
		}
		"maximize" => {
			let restore = shared.pet.lock().unwrap().studio_restore.take();
			match restore {
				Some(bounds) => set_bounds(&studio, fit_studio(&monitor, bounds)),
				None => {
					shared.pet.lock().unwrap().studio_restore = Some((position, size));
					let area = monitor.work_area();
					set_bounds(&studio, (area.position, area.size));
				}
			}
		}
		"smaller" | "larger" => {
			let factor = if action == "larger" { STUDIO_ZOOM_STEP } else { 1.0 / STUDIO_ZOOM_STEP };
			shared.pet.lock().unwrap().studio_restore = None;
			let size = PhysicalSize::new((size.width as f64 * factor) as u32, (size.height as f64 * factor) as u32);
			set_bounds(&studio, fit_studio(&monitor, (position, size)));
		}
		_ => {}
	}
}

/* ------------------------------- commands ------------------------------- */

#[tauri::command]
fn init(app: AppHandle, shared: tauri::State<Shared>) -> Value {
	let catalog: Value = serde_json::from_str(CATALOG_JSON).expect("catalog.json is valid JSON");
	let monitors: Vec<Value> = app
		.available_monitors()
		.unwrap_or_default()
		.iter()
		.enumerate()
		.map(|(index, monitor)| {
			let size = monitor.size();
			json!({ "id": index, "label": format!("Screen {} · {}×{}", index + 1, size.width, size.height) })
		})
		.collect();
	let state = shared.backend.lock().unwrap().state();
	json!({
		"state": state,
		"items": catalog["items"],
		"filters": catalog["filters"],
		"monitors": monitors,
		"status": status(&shared),
	})
}

fn open_folder(path: &std::path::Path) {
	let opener = if cfg!(windows) {
		"explorer"
	} else if cfg!(target_os = "macos") {
		"open"
	} else {
		"xdg-open"
	};
	let _ = std::process::Command::new(opener).arg(path).spawn();
}

/// Commands that only act on windows or the OS; `None` means `name` changes the collection instead.
fn action_command(app: &AppHandle, shared: &Shared, name: &str, argument: &Value) -> Option<Result<Value, String>> {
	let done = Some(Ok(Value::Null));
	match name {
		"open" => {
			show_studio(app, shared, argument.as_str().map(String::from));
			done
		}
		"hide" => {
			if let Some(studio) = window(app, STUDIO_LABEL) {
				let _ = studio.hide();
			}
			done
		}
		"window" => {
			resize_studio(app, shared, argument.as_str().unwrap_or(""));
			done
		}
		"emote" => {
			let id = argument.as_str().unwrap_or("");
			if !shared.backend.lock().unwrap().can_play_emote(id) {
				return Some(Err("Emote not owned".into()));
			}
			let _ = app.emit_to(PET_LABEL, "emote", id);
			done
		}
		"recenter" => {
			reset_pet(app, shared);
			done
		}
		// Clicking the pet counts as a tap only when no global hook already reported the click.
		"tap" => {
			if !hook_status(shared).contains("connected") {
				handle_input(app, shared, "MouseLeft".into(), true, "left");
				handle_input(app, shared, "MouseLeft".into(), false, "left");
			}
			done
		}
		"folder" => {
			open_folder(shared.store.directory());
			done
		}
		"quit" => {
			// The save is flushed on RunEvent::Exit.
			app.exit(0);
			done
		}
		"export-data" => {
			let target = app
				.dialog()
				.file()
				.set_title("Export Wuwa Tappo Data")
				.set_file_name("wuwa-tappo-data.json")
				.set_directory(dirs::download_dir().unwrap_or_default())
				.add_filter("JSON", &["json"])
				.blocking_save_file();
			let Some(path) = target.and_then(|path| path.into_path().ok()) else {
				return Some(Ok(json!("cancelled")));
			};
			let content = shared.backend.lock().unwrap().state_json();
			Some(std::fs::write(path, content).map(|_| json!("exported")).map_err(|error| error.to_string()))
		}
		_ => None,
	}
}

/// After a collection command: save, sync every window and apply what changed.
fn finish_state_command(app: &AppHandle, shared: &Shared, name: &str, reply: &Value) -> Value {
	if reply["ok"] != json!(true) {
		return reply.clone();
	}
	match name {
		"settings" => {
			refresh_cache(shared);
			apply_settings(app, shared, reply.get("previousSettings"));
		}
		"import-data" | "reset-data" => {
			refresh_cache(shared);
			apply_settings(app, shared, None);
			place_pet(app, shared, name == "reset-data");
		}
		_ => {}
	}
	let saved = save_now(app, shared);
	broadcast_state(app, &refresh_cache(shared));
	let warning = if saved { String::new() } else { SAVE_FAILED.to_string() };
	json!({ "ok": true, "result": reply["result"], "warning": warning })
}

/// Every `petAPI.command(name, argument)` call, from either window (src/node/commands.ts).
#[tauri::command]
async fn command(
	app: AppHandle,
	window: tauri::Window,
	shared: tauri::State<'_, Shared>,
	name: String,
	argument: Value,
) -> Result<Value, ()> {
	let shared = shared.inner().clone();
	if window.label() == PET_LABEL && !PET_COMMANDS.contains(&name.as_str()) {
		return Ok(json!({ "ok": false, "error": "Command not allowed from this window" }));
	}
	if let Some(result) = action_command(&app, &shared, &name, &argument) {
		return Ok(match result {
			Ok(result) => json!({ "ok": true, "result": result }),
			Err(error) => json!({ "ok": false, "error": error }),
		});
	}

	let argument = if name == "import-data" {
		let chosen = app.dialog().file().set_title("Import Wuwa Tappo Data").add_filter("JSON", &["json"]).blocking_pick_file();
		let Some(path) = chosen.and_then(|path| path.into_path().ok()) else {
			return Ok(json!({ "ok": true, "result": "cancelled" }));
		};
		match std::fs::read_to_string(path) {
			Ok(text) => Value::String(text),
			Err(_) => return Ok(json!({ "ok": false, "error": "This file is not a valid Wuwa Tappo save" })),
		}
	} else {
		argument
	};
	let reply = shared.backend.lock().unwrap().command(&name, &argument);
	Ok(finish_state_command(&app, &shared, &name, &reply))
}

/// The pointer was released (Wayland): ends a cursor-driven drag and remembers where the pet is.
#[tauri::command]
fn end_pet_drag(app: AppHandle, shared: tauri::State<Shared>) {
	#[cfg(target_os = "linux")]
	if kwin_cursor::end_drag() {
		if let Some((x, y)) = wayland::origin() {
			shared.backend.lock().unwrap().set_pet_position(x, y);
			save_later(&app, &shared);
		}
	}
	let _ = (&app, &shared);
}

/// Drag delta from the renderer, in CSS pixels; the new spot is remembered.
#[tauri::command]
fn move_pet(app: AppHandle, shared: tauri::State<Shared>, dx: f64, dy: f64) {
	let settings = settings(&shared);
	if setting_bool(&settings, "passthrough", false) || setting_bool(&settings, "lockDrag", false) {
		return;
	}
	let Some(window) = window(&app, PET_LABEL) else { return };
	#[cfg(target_os = "linux")]
	if layer_pet() {
		let Some(monitor) = active_monitor(&app, &settings) else { return };
		// On KDE the real cursor drives the drag (kwin_cursor); these deltas fall short on Wayland.
		if kwin_cursor::drag(monitor.clone(), pet_size(&settings)) {
			return;
		}
		let (x, y) = wayland::drag(&app, &monitor, pet_size(&settings), dx, dy);
		shared.backend.lock().unwrap().set_pet_position(x, y);
		save_later(&app, &shared);
		return;
	}
	let (Ok(position), Ok(scale)) = (window.outer_position(), window.scale_factor()) else { return };
	let next = PhysicalPosition::new(position.x + (dx * scale).round() as i32, position.y + (dy * scale).round() as i32);
	let _ = window.set_position(next);
	let logical = next.to_logical::<f64>(scale);
	shared.backend.lock().unwrap().set_pet_position(logical.x, logical.y);
	save_later(&app, &shared);
}

#[tauri::command]
fn set_hover_area(shared: tauri::State<Shared>, area: HoverArea) {
	let valid = [area.left, area.top, area.right, area.bottom].iter().all(|v| v.is_finite() && (0.0..=1.0).contains(v));
	if valid {
		shared.pet.lock().unwrap().hover_area = Some(area);
	}
}

/// The studio is frameless; its edge handles report pointer deltas in CSS pixels.
#[tauri::command]
fn resize_studio_edge(app: AppHandle, shared: tauri::State<Shared>, edge: String, dx: f64, dy: f64) {
	let Some(studio) = window(&app, STUDIO_LABEL) else { return };
	let (Some((monitor, (position, size))), Ok(scale)) = (studio_bounds(&studio), studio.scale_factor()) else {
		return;
	};
	if !dx.is_finite() || !dy.is_finite() {
		return;
	}
	shared.pet.lock().unwrap().studio_restore = None;
	let (dx, dy) = ((dx * scale).round() as i32, (dy * scale).round() as i32);
	let (mut x, mut y, mut width, mut height) = (position.x, position.y, size.width as i32, size.height as i32);
	if edge.contains('e') {
		width += dx;
	}
	if edge.contains('s') {
		height += dy;
	}
	if edge.contains('w') {
		x += dx;
		width -= dx;
	}
	if edge.contains('n') {
		y += dy;
		height -= dy;
	}
	let bounds = (PhysicalPosition::new(x, y), PhysicalSize::new(width.max(1) as u32, height.max(1) as u32));
	set_bounds(&studio, fit_studio(&monitor, bounds));
}

/* --------------------------------- input -------------------------------- */

const EMOTE_HOTKEYS: [&str; 5] = ["1", "2", "3", "4", "5"];

fn handle_input(app: &AppHandle, shared: &Shared, key: String, down: bool, side: &str) {
	let (counted, hotkey_emote) = {
		let mut pet = shared.pet.lock().unwrap();
		if !setting_bool(&pet.settings, "inputEnabled", true) {
			return;
		}
		if !down {
			pet.pressed.remove(&key);
			(false, None)
		} else {
			// Key repeat: the OS resends keydown while held; only the first press counts.
			if !pet.pressed.insert(key.clone()) {
				return;
			}
			let group = gamepad::trigger_group(&key);
			let same_trigger_held =
				group.is_some() && pet.pressed.iter().any(|held| held != &key && gamepad::trigger_group(held) == group);
			// Ctrl/Meta+Alt+1…5 plays the emote in that slot (src/node/input-manager.ts).
			let modifiers = ["Ctrl", "CtrlRight", "Meta", "MetaRight"].iter().any(|held| pet.pressed.contains(*held))
				&& ["Alt", "AltRight"].iter().any(|held| pet.pressed.contains(*held));
			let slot = EMOTE_HOTKEYS.iter().position(|hotkey| *hotkey == key);
			let hotkey_emote = slot.filter(|_| modifiers).and_then(|slot| pet.emotes.get(slot).cloned());
			(!same_trigger_held, hotkey_emote)
		}
	};

	if counted {
		let tap = shared.backend.lock().unwrap().tap();
		shared.pet.lock().unwrap().counts = (tap["count"].clone(), tap["totalCount"].clone(), tap["dailyCount"].clone());
		if tap["count"] == json!(0) {
			// The counter wrapped: save right away and play the automatic emote, if any.
			save_now(app, shared);
			if let Some(emote) = tap["emote"].as_str() {
				let _ = app.emit_to(PET_LABEL, "emote", emote);
			}
		} else {
			save_later(app, shared);
		}
	}

	let message = {
		let mut pet = shared.pet.lock().unwrap();
		pet.serial += 1;
		json!({
			"key": key,
			"down": down,
			"side": side,
			"count": pet.counts.0,
			"totalCount": pet.counts.1,
			"dailyCount": pet.counts.2,
			"countedTap": counted,
			"serial": pet.serial,
		})
	};
	let _ = app.emit_to(PET_LABEL, "input", message);
	if let Some(emote) = hotkey_emote {
		let _ = app.emit_to(PET_LABEL, "emote", emote);
	}
}

/// Global keyboard and mouse hook on macOS. Without Input Monitoring the status says so (and the tray
/// offers the settings page); the hook starts once the permission is there.
#[cfg(target_os = "macos")]
fn start_input_hook(app: AppHandle, shared: Shared) {
	const PERMISSION_POLL: Duration = Duration::from_secs(2);
	const TAP_RETRY: Duration = Duration::from_secs(10);
	let set_error = |app: &AppHandle, shared: &Shared, error: Option<String>| {
		let changed = {
			let mut pet = shared.pet.lock().unwrap();
			std::mem::replace(&mut pet.hook_error, error.clone()) != error
		};
		if changed {
			if let Some(error) = &error {
				eprintln!("{error}");
			}
			input_status_changed(app, shared);
		}
	};
	std::thread::spawn(move || loop {
		if macos_input::has_permission(false) {
			set_error(&app, &shared, None);
		}
		let (hook_app, hook_shared) = (app.clone(), shared.clone());
		let result = macos_input::listen(move |key, down, side| handle_input(&hook_app, &hook_shared, key, down, side));
		match result {
			Err(macos_input::ListenError::Permission) => {
				set_error(&app, &shared, Some(macos_input::PERMISSION_STATUS.into()));
				while !macos_input::has_permission(false) {
					std::thread::sleep(PERMISSION_POLL);
				}
			}
			_ => {
				set_error(&app, &shared, Some("Global input hook failed: could not create the event tap".into()));
				std::thread::sleep(TAP_RETRY);
			}
		}
	});
}

/// Global keyboard and mouse hook. rdev needs X11 on Linux (evdev covers Wayland).
#[cfg(not(target_os = "macos"))]
fn start_input_hook(app: AppHandle, shared: Shared) {
	let devices = shared.devices.clone();
	std::thread::spawn(move || {
		let hook_shared = shared.clone();
		let hook_app = app.clone();
		let result = rdev::listen(move |event| match event.event_type {
			rdev::EventType::KeyPress(_) | rdev::EventType::KeyRelease(_) if devices.keyboard.load(Ordering::Relaxed) => {}
			rdev::EventType::ButtonPress(_) | rdev::EventType::ButtonRelease(_)
				if devices.mouse.load(Ordering::Relaxed) => {}
			rdev::EventType::KeyPress(key) => {
				let name = keys::key_name(key);
				let side = keys::keyboard_side(&name);
				handle_input(&hook_app, &hook_shared, name, true, side);
			}
			rdev::EventType::KeyRelease(key) => {
				let name = keys::key_name(key);
				let side = keys::keyboard_side(&name);
				handle_input(&hook_app, &hook_shared, name, false, side);
			}
			rdev::EventType::ButtonPress(button) => {
				if let Some(name) = keys::mouse_name(button) {
					handle_input(&hook_app, &hook_shared, name.into(), true, keys::mouse_side(name));
				}
			}
			rdev::EventType::ButtonRelease(button) => {
				if let Some(name) = keys::mouse_name(button) {
					handle_input(&hook_app, &hook_shared, name.into(), false, keys::mouse_side(name));
				}
			}
			_ => {}
		});
		// listen() only returns on failure.
		let error = format!("Global input hook failed: {result:?}");
		eprintln!("{error}");
		shared.pet.lock().unwrap().hook_error = Some(error);
		input_status_changed(&app, &shared);
	});
}

/// Tells every window about a new input status and updates the tray's permission item.
fn input_status_changed(app: &AppHandle, shared: &Shared) {
	broadcast_status(app, shared);
	refresh_tray(app, shared);
}

#[cfg(target_os = "linux")]
fn start_evdev(app: &AppHandle, shared: &Shared) {
	let (input_app, input_shared) = (app.clone(), shared.clone());
	let touchpad_shared = shared.clone();
	let (changed_app, changed_shared) = (app.clone(), shared.clone());
	evdev::start(
		shared.devices.clone(),
		evdev::Callbacks {
			input: Box::new(move |key, down, side| handle_input(&input_app, &input_shared, key, down, side)),
			touchpad_input: Box::new(move || setting_bool(&settings(&touchpad_shared), "touchpadInput", false)),
			devices_changed: Box::new(move || input_status_changed(&changed_app, &changed_shared)),
		},
	);
}

/* ---------------------------------- tray --------------------------------- */

/// Tray menu entries, shared by the Tauri tray (Windows, macOS) and the StatusNotifierItem tray
/// (Linux). The same items as the Electron tray (src/node/main.ts).
#[derive(Clone, Copy)]
pub enum TrayAction {
	Studio,
	ShowPet,
	Passthrough,
	Input,
	FixInput,
	Quit,
}

pub struct TrayItem {
	pub action: TrayAction,
	pub label: &'static str,
	/// `Some` for check items.
	pub checked: Option<bool>,
	/// A separator is drawn before this item.
	pub separator_before: bool,
}

pub fn tray_items(shared: &Shared) -> Vec<TrayItem> {
	let settings = settings(shared);
	let item = |action, label, checked, separator_before| TrayItem { action, label, checked, separator_before };
	let mut items = vec![
		item(TrayAction::Studio, "Collection and Outfits", None, false),
		item(TrayAction::ShowPet, "Show Pet / Reset to Screen Corner", None, false),
		item(TrayAction::Passthrough, "Mouse Passthrough", Some(setting_bool(&settings, "passthrough", false)), false),
		item(TrayAction::Input, "Enable Keyboard and Mouse Input", Some(setting_bool(&settings, "inputEnabled", true)), false),
	];
	// Offered only while global input is missing, like Electron's one-click fix.
	if cfg!(target_os = "linux") && !shared.devices.keyboard.load(Ordering::Relaxed) {
		items.push(item(TrayAction::FixInput, "⚡ Fix Input Permissions (Linux)", None, false));
	}
	if cfg!(target_os = "macos") && shared.pet.lock().unwrap().hook_error.is_some() {
		items.push(item(TrayAction::FixInput, "⚡ Open Input Monitoring Settings (macOS)", None, false));
	}
	items.push(item(TrayAction::Quit, "Exit Wuwa Tappo", None, true));
	items
}

pub fn tray_action(app: &AppHandle, shared: &Shared, action: TrayAction) {
	match action {
		TrayAction::Studio => show_studio(app, shared, None),
		TrayAction::ShowPet => reset_pet(app, shared),
		TrayAction::Passthrough => toggle_setting(app, shared, "passthrough"),
		TrayAction::Input => toggle_setting(app, shared, "inputEnabled"),
		#[cfg(target_os = "linux")]
		TrayAction::FixInput => linux_input_access::grant(app.clone()),
		#[cfg(target_os = "macos")]
		TrayAction::FixInput => {
			let _ = std::process::Command::new("open").arg(macos_input::INPUT_MONITORING_SETTINGS).spawn();
		}
		#[cfg(windows)]
		TrayAction::FixInput => {}
		TrayAction::Quit => app.exit(0),
	}
}

fn tray_menu(app: &AppHandle, shared: &Shared) -> tauri::Result<Menu<tauri::Wry>> {
	let menu = Menu::new(app)?;
	for (index, item) in tray_items(shared).into_iter().enumerate() {
		if item.separator_before {
			menu.append(&PredefinedMenuItem::separator(app)?)?;
		}
		let id = index.to_string();
		match item.checked {
			Some(checked) => menu.append(&CheckMenuItem::with_id(app, id, item.label, true, checked, None::<&str>)?)?,
			None => menu.append(&MenuItem::with_id(app, id, item.label, true, None::<&str>)?)?,
		}
	}
	Ok(menu)
}

/// Rebuilds the tray menu so its check marks and items follow the current state.
fn refresh_tray(app: &AppHandle, shared: &Shared) {
	#[cfg(target_os = "linux")]
	if linux_tray::refresh() {
		return;
	}
	let (handle, shared) = (app.clone(), shared.clone());
	let _ = app.run_on_main_thread(move || {
		let Some(tray) = handle.tray_by_id(TRAY_ID) else { return };
		if let Ok(menu) = tray_menu(&handle, &shared) {
			let _ = tray.set_menu(Some(menu));
		}
	});
}

/// Tauri's tray: left click opens the studio, right click shows the menu (Windows, macOS). On Linux
/// it is the fallback when no StatusNotifierItem host is running; clicks are not reported there.
fn create_tauri_tray(app: &AppHandle, shared: &Shared) -> tauri::Result<()> {
	let menu = tray_menu(app, shared)?;
	let (menu_shared, click_shared) = (shared.clone(), shared.clone());
	TrayIconBuilder::with_id(TRAY_ID)
		.icon(app.default_window_icon().expect("bundle icon").clone())
		.tooltip("Wuwa Tappo · Desktop Companion")
		.menu(&menu)
		.show_menu_on_left_click(false)
		.on_menu_event(move |app, event| {
			let items = tray_items(&menu_shared);
			if let Some(item) = event.id().as_ref().parse::<usize>().ok().and_then(|index| items.get(index)) {
				tray_action(app, &menu_shared, item.action);
			}
		})
		.on_tray_icon_event(move |tray, event| {
			if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
				show_studio(tray.app_handle(), &click_shared, None);
			}
		})
		.build(app)?;
	Ok(())
}

fn create_tray(app: &AppHandle, shared: &Shared) -> tauri::Result<()> {
	#[cfg(target_os = "linux")]
	if linux_tray::start(app, shared) {
		return Ok(());
	}
	create_tauri_tray(app, shared)
}

/// The tray's "Fix Input Permissions": grants this user read access to /dev/input after an explicit
/// warning, like the Electron app (src/node/main.ts). evdev rescans every second, so the pet reacts
/// as soon as the access is granted.
#[cfg(target_os = "linux")]
mod linux_input_access {
	use std::path::PathBuf;
	use std::process::Command;
	use tauri::AppHandle;
	use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

	/// pkexec resets PATH for the root process, so setfacl is passed by absolute path (on NixOS it is
	/// not in /usr/bin).
	fn find_executable(name: &str) -> Option<PathBuf> {
		std::env::var_os("PATH")
			.into_iter()
			.flat_map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
			.map(|directory| directory.join(name))
			.find(|candidate| candidate.is_file())
	}

	fn input_devices() -> Vec<PathBuf> {
		let Ok(entries) = std::fs::read_dir("/dev/input") else { return Vec::new() };
		entries
			.flatten()
			.map(|entry| entry.path())
			.filter(|path| {
				let name = path.file_name().and_then(|name| name.to_str()).unwrap_or("");
				name.strip_prefix("event").is_some_and(|number| number.parse::<u32>().is_ok())
			})
			.collect()
	}

	/// The login name from the OS (`id -un`), not the spoofable $USER.
	fn user_name() -> Option<String> {
		let output = Command::new("id").arg("-un").output().ok()?;
		let name = String::from_utf8(output.stdout).ok()?.trim().to_string();
		(!name.is_empty()).then_some(name)
	}

	fn help(app: &AppHandle, reason: &str) {
		let advice = if std::path::Path::new("/etc/NIXOS").exists() {
			"On NixOS, enable it declaratively instead:\n  programs.wuwa-tappo.inputAccess = true;\n(from this project's flake NixOS module), then rebuild and log in again."
		} else {
			"Run ./fix-permissions.sh from the project folder, or install packaging/linux/70-wuwa-tappo-input.rules into /etc/udev/rules.d/ and log in again."
		};
		app.dialog()
			.message(format!("{reason}\n\n{advice}"))
			.title("Grant Input Access")
			.kind(MessageDialogKind::Info)
			.blocking_show();
	}

	pub fn grant(app: AppHandle) {
		// Blocking dialogs must not run on the main (GTK) thread.
		std::thread::spawn(move || {
			let confirmed = app
				.dialog()
				.message(
					"Wuwa Tappo needs read access to /dev/input to see global key presses on Wayland. \
					 This access applies to every program running as your user, not only Wuwa Tappo, \
					 and lasts until the devices are re-created (usually until reboot).",
				)
				.title("Allow reading keyboard and mouse devices?")
				.kind(MessageDialogKind::Warning)
				.buttons(MessageDialogButtons::OkCancelCustom("Grant Access".into(), "Cancel".into()))
				.blocking_show();
			if !confirmed {
				return;
			}

			let devices = input_devices();
			let (Some(pkexec), Some(setfacl)) = (find_executable("pkexec"), find_executable("setfacl")) else {
				return help(&app, "pkexec (polkit) or setfacl (acl) is not installed.");
			};
			let Some(user) = user_name() else { return help(&app, "Could not determine the user name.") };
			if devices.is_empty() {
				return;
			}
			match Command::new(pkexec).arg(setfacl).arg("-m").arg(format!("u:{user}:r")).args(&devices).status() {
				Ok(status) if status.success() => {}
				// 126: the polkit prompt was dismissed.
				Ok(status) if status.code() == Some(126) => {}
				Ok(status) => help(&app, &format!("Granting access failed ({status}).")),
				Err(error) => help(&app, &format!("Granting access failed: {error}.")),
			}
		});
	}
}

/* ---------------------------------- run ---------------------------------- */

pub fn run() {
	let app = tauri::Builder::default()
		// Must be the first plugin. A second launch brings this one's pet and studio forward
		// instead of running a second copy that would overwrite the same save.
		.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
			if let Some(shared) = app.try_state::<Shared>() {
				let shared = shared.inner().clone();
				show_pet(app);
				show_studio(app, &shared, None);
			}
		}))
		.plugin(tauri_plugin_dialog::init())
		.invoke_handler(tauri::generate_handler![init, command, move_pet, end_pet_drag, set_hover_area, resize_studio_edge])
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
				pet: Mutex::new(Pet {
					settings: Value::Null,
					emotes: Vec::new(),
					counts: (Value::Null, Value::Null, Value::Null),
					pressed: HashSet::new(),
					serial: 0,
					hover_area: None,
					tracking_cursor: false,
					hook_error: None,
					save_warning: warning,
					studio_loaded: false,
					pending_page: None,
					studio_restore: None,
				}),
				backend: Mutex::new(backend),
				store,
				save_scheduled: AtomicBool::new(false),
				devices: Arc::new(InputDevices::default()),
			});
			refresh_cache(&shared);
			app.manage(shared.clone());

			let handle = app.handle().clone();
			save_now(&handle, &shared);
			create_pet_window(&handle, &shared)?;
			create_tray(&handle, &shared)?;
			start_input_hook(handle.clone(), shared.clone());
			#[cfg(target_os = "linux")]
			start_evdev(&handle, &shared);
			{
				let (app, shared) = (handle.clone(), shared.clone());
				gamepad::start(move |key, down| {
					let side = gamepad::side(&key);
					handle_input(&app, &shared, key, down, side);
				});
			}
			// A fresh profile opens the studio, as in the Electron app.
			let state = shared.backend.lock().unwrap().state();
			let first_run =
				state["draws"] == json!(0) && state["presets"].as_array().is_none_or(|presets| presets.is_empty());
			if first_run || std::env::args().any(|argument| argument == "--studio") {
				show_studio(&handle, &shared, None);
			}
			#[cfg(target_os = "linux")]
			if wayland_session() {
				kwin_cursor::start(&handle, &shared);
			}
			let poll_shared = shared.clone();
			std::thread::spawn(move || poll_cursor(handle, poll_shared));
			Ok(())
		})
		.build(tauri::generate_context!())
		.expect("error while building Wuwa Tappo");

	app.run(|app, event| {
		// Closing the studio only hides it, so the app keeps running until "Exit".
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
