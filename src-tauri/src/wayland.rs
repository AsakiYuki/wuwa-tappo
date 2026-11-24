//! Native Wayland support for the pet.
//!
//! Wayland windows cannot place themselves or stay above others, so on compositors with
//! wlr-layer-shell (KDE Plasma, Hyprland, Sway, …) the pet is a layer surface instead: anchored to
//! the bottom-right corner of its screen and moved by changing its margins, on the overlay layer
//! when "always on top" is set (else the bottom layer, under windows), and never in the taskbar.
//!
//! Tauri's own (tao) window cannot become a layer surface: with its WebView it never draws a frame
//! there. So the pet's content (Tauri's `default_vbox`, which holds the WebView) is moved into a plain
//! GTK window made for the layer surface, and the tao window stays hidden. Showing, sizing and
//! click-through of the pet therefore go through this module rather than Tauri's window API.
//!
//! Positions stay in the save's format (`petPosition`, the window's top-left in logical pixels), so
//! an X11 session puts the pet in the same place.
//!
//! GTK may only be used on the main thread; public functions dispatch there unless noted.

use gtk::gdk;
use gtk::prelude::*;
use gtk_layer_shell::{Edge, KeyboardMode, Layer, LayerShell};
use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Monitor, WebviewWindow};

/// Same corner as on other platforms (`pet.rs`).
const CORNER_MARGIN: (f64, f64) = (24.0, 12.0);

static WAYLAND: AtomicBool = AtomicBool::new(false);
static LAYER_SHELL: AtomicBool = AtomicBool::new(false);
/// The pet's distance from the right and bottom edges of its screen, in logical pixels.
static MARGINS: Mutex<(f64, f64)> = Mutex::new(CORNER_MARGIN);
/// The pet's current top-left in global logical pixels (KWin's coordinates), once placed.
static ORIGIN: Mutex<Option<(f64, f64)>> = Mutex::new(None);

thread_local! {
	/// The layer-surface window holding the pet's WebView (main thread only).
	static LAYER_WINDOW: RefCell<Option<gtk::Window>> = const { RefCell::new(None) };
}

/// Records whether GTK runs on Wayland (not XWayland). Main thread, once at startup.
pub fn detect() {
	let wayland = gdk::Display::default().is_some_and(|display| display.type_().name() == "GdkWaylandDisplay");
	WAYLAND.store(wayland, Ordering::Relaxed);
}

/// Whether the app runs as a native Wayland client (any thread, after `detect`).
pub fn session() -> bool {
	WAYLAND.load(Ordering::Relaxed)
}

/// Whether the pet is a layer surface (decided once, when it is created).
pub fn layer_shell() -> bool {
	LAYER_SHELL.load(Ordering::Relaxed)
}

/// Moves the freshly built, hidden pet's content into a new layer-surface window, if the compositor
/// supports layer-shell. Main thread. Returns false (pet stays a normal window) otherwise.
pub fn init_pet(window: &WebviewWindow, (width, height): (f64, f64)) -> bool {
	// WUWA_TAPPO_LAYER_SHELL=0 keeps the pet a normal window, should a compositor misbehave.
	let disabled = std::env::var("WUWA_TAPPO_LAYER_SHELL").is_ok_and(|value| value == "0");
	if disabled || !session() || !gtk_layer_shell::is_supported() {
		return false;
	}
	let (Ok(tao_window), Ok(content)) = (window.gtk_window(), window.default_vbox()) else { return false };

	let layer = gtk::Window::new(gtk::WindowType::Toplevel);
	// Transparent: an RGBA visual and no background of its own, so only the page is drawn.
	if let Some(visual) = WidgetExt::screen(&layer).and_then(|screen| screen.rgba_visual()) {
		layer.set_visual(Some(&visual));
	}
	layer.set_app_paintable(true);
	layer.set_decorated(false);
	layer.set_title("Wuwa Tappo");
	layer.init_layer_shell();
	// KWin derives a layer surface's window type from its namespace and treats unknown ones as normal
	// windows, which window effects (e.g. "Geometry Change") then animate on every drag step, leaving
	// a trail. As a dock it is left alone (and stays up on "Show Desktop"). Elsewhere the namespace
	// names the app, for compositor rules (Hyprland's layerrule, …).
	let kde = std::env::var("XDG_CURRENT_DESKTOP").is_ok_and(|desktop| desktop.to_uppercase().contains("KDE"));
	layer.set_namespace(if kde { "dock" } else { "wuwa-tappo" });
	layer.set_keyboard_mode(KeyboardMode::None);
	layer.set_anchor(Edge::Right, true);
	layer.set_anchor(Edge::Bottom, true);
	layer.set_size_request(width.round() as i32, height.round() as i32);

	tao_window.remove(&content);
	layer.add(&content);
	LAYER_WINDOW.with(|cell| *cell.borrow_mut() = Some(layer));
	LAYER_SHELL.store(true, Ordering::Relaxed);
	true
}

/// Runs `action` on the layer window, on the main thread.
fn with_layer(app: &AppHandle, action: impl FnOnce(&gtk::Window) + Send + 'static) {
	let _ = app.run_on_main_thread(move || {
		LAYER_WINDOW.with(|cell| {
			if let Some(layer) = cell.borrow().as_ref() {
				action(layer);
			}
		})
	});
}

pub fn show(app: &AppHandle) {
	with_layer(app, |layer| layer.show_all());
}

/// Mouse passthrough: an empty input region lets every click reach what is underneath.
pub fn set_passthrough(app: &AppHandle, enabled: bool) {
	with_layer(app, move |layer| {
		let empty = gtk::cairo::Region::create();
		layer.input_shape_combine_region(if enabled { Some(&empty) } else { None });
	});
}

/// The screen's logical bounds: x, y, width, height.
fn logical_bounds(monitor: &Monitor) -> (f64, f64, f64, f64) {
	let scale = monitor.scale_factor();
	let position = monitor.position().to_logical::<f64>(scale);
	let size = monitor.size().to_logical::<f64>(scale);
	(position.x, position.y, size.width, size.height)
}

/// Keeps the whole pet on its screen.
fn clamp_margins((right, bottom): (f64, f64), monitor: &Monitor, (width, height): (f64, f64)) -> (f64, f64) {
	let (_, _, screen_width, screen_height) = logical_bounds(monitor);
	(right.clamp(0.0, (screen_width - width).max(0.0)), bottom.clamp(0.0, (screen_height - height).max(0.0)))
}

/// Margins for a saved top-left position, or the default corner.
pub fn margins_for(position: Option<(f64, f64)>, monitor: &Monitor, size: (f64, f64)) -> (f64, f64) {
	let Some((x, y)) = position else { return CORNER_MARGIN };
	let (screen_x, screen_y, screen_width, screen_height) = logical_bounds(monitor);
	clamp_margins((screen_x + screen_width - x - size.0, screen_y + screen_height - y - size.1), monitor, size)
}

/// The top-left position, as saved, for the current margins.
pub fn saved_position(monitor: &Monitor, (width, height): (f64, f64)) -> (f64, f64) {
	let (right, bottom) = *MARGINS.lock().unwrap();
	let (screen_x, screen_y, screen_width, screen_height) = logical_bounds(monitor);
	let origin = (screen_x + screen_width - right - width, screen_y + screen_height - bottom - height);
	*ORIGIN.lock().unwrap() = Some(origin);
	origin
}

/// The pet's top-left as last placed or dragged (any thread, no GTK call).
pub fn origin() -> Option<(f64, f64)> {
	*ORIGIN.lock().unwrap()
}

fn apply_margins(layer: &gtk::Window, (right, bottom): (f64, f64)) {
	layer.set_layer_shell_margin(Edge::Right, right.round() as i32);
	layer.set_layer_shell_margin(Edge::Bottom, bottom.round() as i32);
}

/// Moves the pet by a drag delta; returns its new top-left position to save.
pub fn drag(app: &AppHandle, monitor: &Monitor, size: (f64, f64), dx: f64, dy: f64) -> (f64, f64) {
	let margins = {
		let mut margins = MARGINS.lock().unwrap();
		*margins = clamp_margins((margins.0 - dx, margins.1 - dy), monitor, size);
		*margins
	};
	with_layer(app, move |layer| apply_margins(layer, margins));
	saved_position(monitor, size)
}

/// Moves the pet so its top-left is at `origin` (kept on its screen); returns where it ended up.
pub fn move_to(app: &AppHandle, monitor: &Monitor, size: (f64, f64), origin: (f64, f64)) -> (f64, f64) {
	let margins = margins_for(Some(origin), monitor, size);
	*MARGINS.lock().unwrap() = margins;
	with_layer(app, move |layer| apply_margins(layer, margins));
	saved_position(monitor, size)
}

/// Places the pet: screen, layer, size and margins.
pub fn place(app: &AppHandle, monitor_index: usize, always_on_top: bool, (width, height): (f64, f64), margins: (f64, f64)) {
	*MARGINS.lock().unwrap() = margins;
	with_layer(app, move |layer| {
		if let Some(monitor) = gdk::Display::default().and_then(|display| display.monitor(monitor_index as i32)) {
			layer.set_monitor(&monitor);
		}
		layer.set_layer(if always_on_top { Layer::Overlay } else { Layer::Bottom });
		layer.set_size_request(width.round() as i32, height.round() as i32);
		layer.resize(width.round() as i32, height.round() as i32);
		apply_margins(layer, margins);
	});
}
