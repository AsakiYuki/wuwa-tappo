//! Tauri prototype of the Wuwa Tappo pet window.
//!
//! It answers the same `petAPI` calls as the Electron main process (see `bridge.js`) so the Vue pet
//! renders unchanged, and covers the parts that decide whether a system WebView is viable: a
//! transparent, frameless, always-on-top window that stays off the taskbar, mouse click-through with
//! cursor forwarding for hover-fade, dragging, a tray icon and a global keyboard/mouse hook.
//!
//! Out of scope: the studio window, saving (the collection is read-only here, so the Electron app's
//! data is never touched), gacha/emote logic, controllers and autostart.

mod keys;

use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{
	AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow,
	WebviewWindowBuilder,
};

const PET_LABEL: &str = "pet";
const BRIDGE_JS: &str = include_str!("../bridge.js");
const CATALOG_JSON: &str = include_str!("../../assets/catalog.json");
/// Pet window size at scale 1 (matches src/node/window-manager.ts).
const PET_SIZE_KEYBOARD: (f64, f64) = (320.0, 350.0);
const PET_SIZE_COMPACT: (f64, f64) = (225.0, 215.0);
const PET_CORNER_MARGIN: (f64, f64) = (24.0, 12.0);
const CURSOR_POLL: Duration = Duration::from_millis(80);

#[derive(Clone, Copy, Deserialize)]
struct HoverArea {
	left: f64,
	top: f64,
	right: f64,
	bottom: f64,
}

struct Pet {
	state: Value,
	pressed: HashSet<String>,
	serial: u64,
	/// Reported by the renderer; Electron uses it for KWin's hover-fade, not ported yet.
	#[allow(dead_code)]
	hover_area: Option<HoverArea>,
	tracking_cursor: bool,
	hook_status: String,
}

type Shared = Arc<Mutex<Pet>>;

fn setting_bool(state: &Value, key: &str, default: bool) -> bool {
	state["settings"][key].as_bool().unwrap_or(default)
}

fn setting_f64(state: &Value, key: &str, default: f64) -> f64 {
	state["settings"][key].as_f64().unwrap_or(default)
}

/// Where the Electron app keeps its data: Electron's `appData` is the OS config directory.
fn collection_path() -> Option<PathBuf> {
	Some(dirs::config_dir()?.join("wuwa-tappo").join("collection.json"))
}

fn load_state() -> Result<Value, String> {
	let path = collection_path().ok_or("no config directory")?;
	let text = std::fs::read_to_string(&path).map_err(|error| {
		format!("{}: {error}. Run the Electron app once to create it.", path.display())
	})?;
	serde_json::from_str(&text).map_err(|error| format!("{}: {error}", path.display()))
}

fn pet_window(app: &AppHandle) -> Option<WebviewWindow> {
	app.get_webview_window(PET_LABEL)
}

/* ------------------------------- commands ------------------------------- */

#[tauri::command]
fn init(pet: tauri::State<Shared>) -> Value {
	let catalog: Value = serde_json::from_str(CATALOG_JSON).expect("catalog.json is valid JSON");
	let pet = pet.lock().unwrap();
	json!({
		"state": pet.state,
		"items": catalog["items"],
		"filters": catalog["filters"],
		"monitors": [],
		"status": { "hook": pet.hook_status },
	})
}

#[tauri::command]
fn command(app: AppHandle, name: String, argument: Value) -> Value {
	match name.as_str() {
		"tap" => json!({ "ok": true }),
		"emote" => {
			let _ = app.emit("emote", argument);
			json!({ "ok": true })
		}
		_ => json!({ "ok": false, "error": format!("'{name}' is not part of the Tauri prototype") }),
	}
}

/// Drag delta from the renderer, in CSS pixels.
#[tauri::command]
fn move_pet(app: AppHandle, pet: tauri::State<Shared>, dx: f64, dy: f64) {
	let state = &pet.lock().unwrap().state;
	if setting_bool(state, "passthrough", false) || setting_bool(state, "lockDrag", false) {
		return;
	}
	let Some(window) = pet_window(&app) else { return };
	let (Ok(position), Ok(scale)) = (window.outer_position(), window.scale_factor()) else { return };
	let _ = window.set_position(PhysicalPosition::new(
		position.x + (dx * scale).round() as i32,
		position.y + (dy * scale).round() as i32,
	));
}

#[tauri::command]
fn set_hover_area(pet: tauri::State<Shared>, area: HoverArea) {
	let valid = [area.left, area.top, area.right, area.bottom].iter().all(|v| v.is_finite() && (0.0..=1.0).contains(v));
	if valid {
		pet.lock().unwrap().hover_area = Some(area);
	}
}

/* -------------------------------- window -------------------------------- */

fn create_pet_window(app: &AppHandle, state: &Value) -> tauri::Result<WebviewWindow> {
	let scale = setting_f64(state, "scale", 1.0);
	let (width, height) =
		if setting_bool(state, "showKeyboard", true) { PET_SIZE_KEYBOARD } else { PET_SIZE_COMPACT };
	let (width, height) = ((width * scale).round(), (height * scale).round());

	let saved = &state["settings"]["petPosition"];
	let position = match (saved["x"].as_f64(), saved["y"].as_f64()) {
		(Some(x), Some(y)) => LogicalPosition::new(x, y),
		_ => {
			let monitor = app.primary_monitor()?.expect("a primary monitor");
			let area = monitor.work_area().size.to_logical::<f64>(monitor.scale_factor());
			let origin = monitor.work_area().position.to_logical::<f64>(monitor.scale_factor());
			LogicalPosition::new(
				origin.x + area.width - width - PET_CORNER_MARGIN.0,
				origin.y + area.height - height - PET_CORNER_MARGIN.1,
			)
		}
	};

	let window = WebviewWindowBuilder::new(app, PET_LABEL, WebviewUrl::App("web/pet.html".into()))
		.title("Wuwa Tappo")
		.inner_size(width, height)
		.position(position.x, position.y)
		.transparent(true)
		.decorations(false)
		.shadow(false)
		.resizable(false)
		.skip_taskbar(true)
		.always_on_top(setting_bool(state, "alwaysOnTop", true))
		.visible_on_all_workspaces(true)
		.focused(false)
		.initialization_script(BRIDGE_JS)
		.build()?;
	let _ = window.set_size(LogicalSize::new(width, height));
	window.set_ignore_cursor_events(setting_bool(state, "passthrough", false))?;
	Ok(window)
}

fn set_passthrough(app: &AppHandle, shared: &Shared, enabled: bool) {
	let state = {
		let mut pet = shared.lock().unwrap();
		pet.state["settings"]["passthrough"] = Value::Bool(enabled);
		pet.state.clone()
	};
	if let Some(window) = pet_window(app) {
		let _ = window.set_ignore_cursor_events(enabled);
	}
	let _ = app.emit("state", state);
}

/// Click-through windows get no hover events, so hover-fade is fed the cursor position instead.
fn poll_cursor(app: AppHandle, shared: Shared) {
	loop {
		std::thread::sleep(CURSOR_POLL);
		let Some(window) = pet_window(&app) else { continue };
		let mut pet = shared.lock().unwrap();
		let active = setting_bool(&pet.state, "passthrough", false) && setting_bool(&pet.state, "hoverFade", true);
		if active {
			let (Ok(cursor), Ok(origin), Ok(scale)) =
				(window.cursor_position(), window.inner_position(), window.scale_factor())
			else {
				continue;
			};
			let message = json!({
				"x": (cursor.x - origin.x as f64) / scale,
				"y": (cursor.y - origin.y as f64) / scale,
			});
			pet.tracking_cursor = true;
			drop(pet);
			let _ = app.emit("cursor", message);
		} else if pet.tracking_cursor {
			pet.tracking_cursor = false;
			drop(pet);
			let _ = app.emit("cursor", Value::Null);
		}
	}
}

/* --------------------------------- input -------------------------------- */

fn handle_input(app: &AppHandle, shared: &Shared, key: String, down: bool, side: &str) {
	let message = {
		let mut pet = shared.lock().unwrap();
		if !setting_bool(&pet.state, "inputEnabled", true) {
			return;
		}
		let mut counted = false;
		if down {
			// Key repeat: the OS resends keydown while held; only the first press counts.
			if !pet.pressed.insert(key.clone()) {
				return;
			}
			counted = true;
			for field in ["count", "totalCount", "dailyCount"] {
				let next = pet.state[field].as_u64().unwrap_or(0) + 1;
				pet.state[field] = json!(next);
			}
		} else {
			pet.pressed.remove(&key);
		}
		pet.serial += 1;
		json!({
			"key": key,
			"down": down,
			"side": side,
			"count": pet.state["count"],
			"totalCount": pet.state["totalCount"],
			"dailyCount": pet.state["dailyCount"],
			"countedTap": counted,
			"serial": pet.serial,
		})
	};
	let _ = app.emit("input", message);
}

/// Global keyboard and mouse hook. rdev needs Accessibility permission on macOS and X11 on Linux.
fn start_input_hook(app: AppHandle, shared: Shared) {
	std::thread::spawn(move || {
		let hook_shared = shared.clone();
		let hook_app = app.clone();
		let result = rdev::listen(move |event| match event.event_type {
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
		let status = format!("Global input hook failed: {result:?}");
		eprintln!("{status}");
		shared.lock().unwrap().hook_status = status.clone();
		let _ = app.emit("status", json!({ "hook": status }));
	});
}

/* ---------------------------------- tray --------------------------------- */

fn create_tray(app: &AppHandle, shared: &Shared) -> tauri::Result<()> {
	let passthrough = setting_bool(&shared.lock().unwrap().state, "passthrough", false);
	let click_through = CheckMenuItem::with_id(app, "passthrough", "Click-through", true, passthrough, None::<&str>)?;
	let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
	let menu = Menu::with_items(app, &[&click_through, &quit])?;

	let shared = shared.clone();
	TrayIconBuilder::with_id("main")
		.icon(app.default_window_icon().expect("bundle icon").clone())
		.tooltip("Wuwa Tappo (Tauri prototype)")
		.menu(&menu)
		.on_menu_event(move |app, event| match event.id().as_ref() {
			"passthrough" => {
				let enabled = click_through.is_checked().unwrap_or(false);
				set_passthrough(app, &shared, enabled);
			}
			"quit" => app.exit(0),
			_ => {}
		})
		.build(app)?;
	Ok(())
}

/* ---------------------------------- run ---------------------------------- */

pub fn run() {
	tauri::Builder::default()
		.invoke_handler(tauri::generate_handler![init, command, move_pet, set_hover_area])
		.setup(|app| {
			let state = load_state().map_err(|error| {
				eprintln!("{error}");
				error
			})?;
			let shared: Shared = Arc::new(Mutex::new(Pet {
				state: state.clone(),
				pressed: HashSet::new(),
				serial: 0,
				hover_area: None,
				tracking_cursor: false,
				hook_status: "Global input connected (rdev)".into(),
			}));
			app.manage(shared.clone());

			let handle = app.handle().clone();
			create_pet_window(&handle, &state)?;
			create_tray(&handle, &shared)?;
			start_input_hook(handle.clone(), shared.clone());
			std::thread::spawn(move || poll_cursor(handle, shared));
			Ok(())
		})
		.run(tauri::generate_context!())
		.expect("error while running the Tauri prototype");
}
