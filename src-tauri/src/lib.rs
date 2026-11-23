//! Tauri port of Wuwa Tappo: the desktop pet and the studio (collection, draws, synthesis, presets,
//! settings), with the same Vue renderer as the Electron app.
//!
//! `bridge.js` re-creates Electron's `window.petAPI` on Tauri's IPC, so the pages run unchanged.
//! The game logic is the Electron app's own TypeScript, run in QuickJS (`backend.rs`); the Rust side
//! owns windows (`pet.rs`, `studio.rs`), input (`input.rs`), the tray (`tray.rs`) and saving (here).
//! The save is the Electron app's collection.json, so both apps share one collection (run only one of
//! them at a time).
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
	/// Reported by the renderer; Electron uses it for KWin's hover-fade (here the page hit-tests).
	#[allow(dead_code)]
	pub hover_area: Option<pet::HoverArea>,
	/// Whether the pet page is being fed the cursor (`pet::feed_cursor`).
	pub tracking_cursor: bool,
	/// Set when the global input hook stopped with an error.
	pub hook_error: Option<String>,
	pub save_warning: String,
	pub studio: studio::StudioState,
}

pub struct Core {
	pub(crate) state: Mutex<AppState>,
	pub(crate) backend: Mutex<Backend>,
	pub(crate) store: Store,
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
	let content = shared.backend.lock().unwrap().state_json();
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

/* ---------------------------------- run ---------------------------------- */

pub fn run() {
	let app = tauri::Builder::default()
		// Must be the first plugin. A second launch brings this one's pet and studio forward
		// instead of running a second copy that would overwrite the same save.
		.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
			if let Some(shared) = app.try_state::<Shared>() {
				let shared = shared.inner().clone();
				pet::show(app);
				studio::show(app, &shared, None);
			}
		}))
		.plugin(tauri_plugin_dialog::init())
		.invoke_handler(tauri::generate_handler![
			commands::init,
			commands::command,
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
					tracking_cursor: false,
					hook_error: None,
					save_warning: warning,
					studio: studio::StudioState::default(),
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
			pet::create(&handle, &shared)?;
			tray::create(&handle, &shared)?;
			input::start(&handle, &shared);
			// A fresh profile opens the studio, as in the Electron app.
			let state = shared.backend.lock().unwrap().state();
			let first_run =
				state["draws"] == json!(0) && state["presets"].as_array().is_none_or(|presets| presets.is_empty());
			if first_run || std::env::args().any(|argument| argument == "--studio") {
				studio::show(&handle, &shared, None);
			}
			pet::start_cursor_feed(&handle, &shared);
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
