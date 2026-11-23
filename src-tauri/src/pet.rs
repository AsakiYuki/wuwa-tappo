//! The pet window: creation, placement, dragging, and the cursor feed behind hover-fade.

#[cfg(target_os = "linux")]
use crate::{kwin_cursor, wayland};
use crate::{
	broadcast_state, layer_pet, page_scripts, refresh_cache, save_later, save_now, setting_bool, setting_f64, settings,
	tray, wayland_session, window, Shared, PET_LABEL,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Window sizes match src/node/window-manager.ts.
const SIZE_KEYBOARD: (f64, f64) = (320.0, 350.0);
const SIZE_COMPACT: (f64, f64) = (225.0, 215.0);
const CORNER_MARGIN: (f64, f64) = (24.0, 12.0);
const CURSOR_POLL: Duration = Duration::from_millis(80);

/// The pet's visible content box, as fractions (0–1) of the pet window's size.
#[derive(Clone, Copy, Deserialize)]
pub(crate) struct HoverArea {
	left: f64,
	top: f64,
	right: f64,
	bottom: f64,
}

impl HoverArea {
	/// Same test as the page's own (PetApp.vue `handleCursor`), for a point relative to the window.
	fn contains(&self, (x, y): (f64, f64), (width, height): (f64, f64)) -> bool {
		x >= self.left * width && x < self.right * width && y >= self.top * height && y < self.bottom * height
	}
}

/// Whether the pet page is being fed the cursor for hover-fade (a click-through pet gets no pointer
/// events). Only changes of the hover state are sent: the cursor moves up to 60 times a second
/// anywhere on screen, and the page only cares whether it is over the pet.
#[derive(Clone, Copy, Default, PartialEq)]
pub(crate) enum CursorFeed {
	#[default]
	Off,
	/// The last hover state sent; `None` while the page has not reported its hover area yet, so
	/// every position is passed on for the page to hit-test.
	On(Option<bool>),
}

/// Pet window size in logical pixels for the current settings.
pub(crate) fn size(settings: &Value) -> (f64, f64) {
	let scale = setting_f64(settings, "scale", 1.0);
	let (width, height) = if setting_bool(settings, "showKeyboard", true) { SIZE_KEYBOARD } else { SIZE_COMPACT };
	((width * scale).round(), (height * scale).round())
}

/// The screen chosen in settings (F8 / "Cycle Screen"), else the primary one.
pub(crate) fn active_monitor(app: &AppHandle, settings: &Value) -> Option<tauri::Monitor> {
	let index = settings["monitor"].as_u64().unwrap_or(0) as usize;
	let monitors = app.available_monitors().unwrap_or_default();
	monitors.into_iter().nth(index).or_else(|| app.primary_monitor().ok().flatten())
}

/// Bottom-right corner of the active screen's work area.
fn corner_position(app: &AppHandle, settings: &Value, (width, height): (f64, f64)) -> LogicalPosition<f64> {
	let Some(monitor) = active_monitor(app, settings) else { return LogicalPosition::new(0.0, 0.0) };
	let area = monitor.work_area().size.to_logical::<f64>(monitor.scale_factor());
	let origin = monitor.work_area().position.to_logical::<f64>(monitor.scale_factor());
	LogicalPosition::new(origin.x + area.width - width - CORNER_MARGIN.0, origin.y + area.height - height - CORNER_MARGIN.1)
}

/// Where the pet goes: its saved spot, or the corner (always, when `reset`).
fn position(app: &AppHandle, settings: &Value, size: (f64, f64), reset: bool) -> LogicalPosition<f64> {
	let saved = &settings["petPosition"];
	match (saved["x"].as_f64(), saved["y"].as_f64()) {
		(Some(x), Some(y)) if !reset => LogicalPosition::new(x, y),
		_ => corner_position(app, settings, size),
	}
}

pub(crate) fn create(app: &AppHandle, shared: &Shared) -> tauri::Result<WebviewWindow> {
	let settings = settings(shared);
	let (width, height) = size(&settings);
	let position = position(app, &settings, (width, height), false);
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
			place(app, shared, false);
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
pub(crate) fn place(app: &AppHandle, shared: &Shared, reset: bool) {
	let Some(window) = window(app, PET_LABEL) else { return };
	let settings = settings(shared);
	let size = size(&settings);
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
	let position = position(app, &settings, size, reset);
	let _ = window.set_position(position);
	shared.backend.lock().unwrap().set_pet_position(position.x, position.y);
	refresh_cache(shared);
}

/// Applies window-level settings to the pet; `previous` tells what changed.
pub(crate) fn apply_settings(app: &AppHandle, shared: &Shared, previous: Option<&Value>) {
	let settings = settings(shared);
	if let Some(window) = window(app, PET_LABEL) {
		if layer_pet() {
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
			place(app, shared, changed("monitor"));
		}
	}
	shared.state.lock().unwrap().pressed.clear();
	tray::refresh(app, shared);
}

/// Shows the pet (on Wayland it may live in a layer-surface window that Tauri does not know).
pub(crate) fn show(app: &AppHandle) {
	#[cfg(target_os = "linux")]
	if layer_pet() {
		return wayland::show(app);
	}
	if let Some(window) = window(app, PET_LABEL) {
		let _ = window.show();
	}
}

/// Shows the pet again and moves it back to the screen corner (it may have been dragged off-screen).
pub(crate) fn reset(app: &AppHandle, shared: &Shared) {
	show(app);
	place(app, shared, true);
	save_now(app, shared);
	broadcast_state(app, &refresh_cache(shared));
}

/* ------------------------------ cursor feed ------------------------------ */

/// Passes the cursor, relative to the pet window in logical pixels, to the page's hover-fade, when
/// it changes whether the cursor is over the pet.
pub(crate) fn feed_cursor(app: &AppHandle, shared: &Shared, x: f64, y: f64) {
	let hovered = {
		let mut state = shared.state.lock().unwrap();
		let hovered = state.hover_area.map(|area| area.contains((x, y), size(&state.settings)));
		if hovered.is_some() && state.cursor == CursorFeed::On(hovered) {
			return;
		}
		state.cursor = CursorFeed::On(hovered);
		hovered
	};
	let _ = app.emit_to(PET_LABEL, "cursor", json!({ "x": x, "y": y, "hovered": hovered }));
}

/// Stops the cursor feed; the page goes back to its own hover events.
fn stop_cursor_feed(app: &AppHandle, shared: &Shared) {
	if std::mem::take(&mut shared.state.lock().unwrap().cursor) != CursorFeed::Off {
		let _ = app.emit_to(PET_LABEL, "cursor", Value::Null);
	}
}

/// Starts what feeds hover-fade the cursor: KWin on KDE Wayland, else a poll of the window system.
pub(crate) fn start_cursor_feed(app: &AppHandle, shared: &Shared) {
	#[cfg(target_os = "linux")]
	if wayland_session() {
		kwin_cursor::start(app, shared);
	}
	let (app, shared) = (app.clone(), shared.clone());
	std::thread::spawn(move || poll_cursor(app, shared));
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
		// Wayland gives apps no global cursor position: on KDE, KWin sends it (kwin_cursor), for the
		// layer-surface pet, whose position the app knows. It is used even without passthrough, since
		// WebKitGTK sometimes misses the pointer leaving a layer surface and `:hover` sticks.
		#[cfg(target_os = "linux")]
		if wayland_session() {
			let wanted = hover_fade && layer_pet();
			kwin_cursor::set_active(wanted || kwin_cursor::dragging());
			if !wanted {
				stop_cursor_feed(&app, &shared);
			}
			continue;
		}
		if !(setting_bool(&settings, "passthrough", false) && hover_fade) {
			stop_cursor_feed(&app, &shared);
			continue;
		}
		let (Ok(cursor), Ok(origin), Ok(scale)) = (window.cursor_position(), window.inner_position(), window.scale_factor())
		else {
			continue;
		};
		feed_cursor(&app, &shared, (cursor.x - origin.x as f64) / scale, (cursor.y - origin.y as f64) / scale);
	}
}

/* -------------------------------- commands -------------------------------- */

/// The pointer was released (Wayland): ends a cursor-driven drag and remembers where the pet is.
#[tauri::command]
pub(crate) fn end_pet_drag(app: AppHandle, shared: tauri::State<Shared>) {
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
pub(crate) fn move_pet(app: AppHandle, shared: tauri::State<Shared>, dx: f64, dy: f64) {
	let settings = settings(&shared);
	if setting_bool(&settings, "passthrough", false) || setting_bool(&settings, "lockDrag", false) {
		return;
	}
	let Some(window) = window(&app, PET_LABEL) else { return };
	#[cfg(target_os = "linux")]
	if layer_pet() {
		let Some(monitor) = active_monitor(&app, &settings) else { return };
		// On KDE the real cursor drives the drag (kwin_cursor); these deltas fall short on Wayland.
		if kwin_cursor::drag(monitor.clone(), size(&settings)) {
			return;
		}
		let (x, y) = wayland::drag(&app, &monitor, size(&settings), dx, dy);
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
pub(crate) fn set_hover_area(shared: tauri::State<Shared>, area: HoverArea) {
	let valid = [area.left, area.top, area.right, area.bottom].iter().all(|v| v.is_finite() && (0.0..=1.0).contains(v));
	if !valid {
		return;
	}
	let mut state = shared.state.lock().unwrap();
	state.hover_area = Some(area);
	// The next cursor position is sent whatever it is, since the pet's box has moved under it.
	if state.cursor != CursorFeed::Off {
		state.cursor = CursorFeed::On(None);
	}
}
