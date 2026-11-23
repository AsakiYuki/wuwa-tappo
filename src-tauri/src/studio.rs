//! The studio window (collection, atlas, chests, synthesis, presets, settings): frameless, created
//! on first use; closing it only hides it.

use crate::{page_scripts, wayland_session, window, Shared, STUDIO_LABEL};
use std::time::Duration;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

const SIZE: (f64, f64) = (1100.0, 756.0);
const MIN_SIZE: (f64, f64) = (680.0, 468.0);
const ZOOM_STEP: f64 = 1.1;
/// Delay before navigating a studio that has just loaded, as in src/node/commands.ts.
const NAVIGATE_AFTER_LOAD: Duration = Duration::from_millis(300);

type Bounds = (PhysicalPosition<i32>, PhysicalSize<u32>);

/// What the app tracks about the studio window.
#[derive(Default)]
pub(crate) struct StudioState {
	loaded: bool,
	/// A page the studio should open once it has loaded.
	pending_page: Option<String>,
	/// Bounds to restore when "maximize" is toggled off.
	restore: Option<Bounds>,
}

/// Clamps studio bounds to the minimum size and keeps the window on its screen.
fn fit(monitor: &tauri::Monitor, (position, size): Bounds) -> Bounds {
	let area = monitor.work_area();
	let scale = monitor.scale_factor();
	let (area_width, area_height) = (area.size.width as f64, area.size.height as f64);
	let min_width = (MIN_SIZE.0 * scale).min(area_width);
	let min_height = (MIN_SIZE.1 * scale).min(area_height);
	let width = (size.width as f64).min(area_width).max(min_width).round();
	let height = (size.height as f64).min(area_height).max(min_height).round();
	let x = (position.x as f64).min(area.position.x as f64 + area_width - width).max(area.position.x as f64);
	let y = (position.y as f64).min(area.position.y as f64 + area_height - height).max(area.position.y as f64);
	(PhysicalPosition::new(x.round() as i32, y.round() as i32), PhysicalSize::new(width as u32, height as u32))
}

fn bounds(studio: &WebviewWindow) -> Option<(tauri::Monitor, Bounds)> {
	// Wayland does not always tell which screen a window is on.
	let monitor = studio.current_monitor().ok().flatten().or_else(|| studio.primary_monitor().ok().flatten())?;
	Some((monitor, (studio.outer_position().ok()?, studio.outer_size().ok()?)))
}

fn set_bounds(window: &WebviewWindow, (position, size): Bounds) {
	let _ = window.set_size(size);
	let _ = window.set_position(position);
}

fn navigate(app: &AppHandle, page: String) {
	let _ = app.emit_to(STUDIO_LABEL, "page", page);
}

/// Shows the studio, creating it on first use. Opens `page` if given.
pub(crate) fn show(app: &AppHandle, shared: &Shared, page: Option<String>) {
	if let Some(studio) = window(app, STUDIO_LABEL) {
		let _ = studio.unminimize();
		if let Some((monitor, bounds)) = bounds(&studio) {
			set_bounds(&studio, fit(&monitor, bounds));
		}
		let _ = studio.show();
		let _ = studio.set_focus();
		let loaded = {
			let mut state = shared.state.lock().unwrap();
			if !state.studio.loaded && page.is_some() {
				state.studio.pending_page = page.clone();
			}
			state.studio.loaded
		};
		if let (true, Some(page)) = (loaded, page) {
			navigate(app, page);
		}
		return;
	}

	shared.state.lock().unwrap().studio.pending_page = page;
	let area = app
		.primary_monitor()
		.ok()
		.flatten()
		.map(|monitor| monitor.work_area().size.to_logical::<f64>(monitor.scale_factor()))
		.unwrap_or(LogicalSize::new(SIZE.0, SIZE.1));
	let page_shared = shared.clone();
	let built = WebviewWindowBuilder::new(app, STUDIO_LABEL, WebviewUrl::App("web/studio.html".into()))
		.title("Wuwa Tappo · Studio & Collection")
		.inner_size(SIZE.0.min(area.width - 50.0), SIZE.1.min(area.height - 50.0))
		.min_inner_size(MIN_SIZE.0.min(area.width), MIN_SIZE.1.min(area.height))
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
				let mut state = page_shared.state.lock().unwrap();
				state.studio.loaded = true;
				state.studio.pending_page.take()
			};
			let _ = studio.set_focus();
			if let Some(page) = page {
				let app = studio.app_handle().clone();
				std::thread::spawn(move || {
					std::thread::sleep(NAVIGATE_AFTER_LOAD);
					navigate(&app, page);
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

/// Hides the studio; the app keeps running.
pub(crate) fn close(app: &AppHandle) {
	if let Some(studio) = window(app, STUDIO_LABEL) {
		let _ = studio.hide();
	}
}

/// The studio's own title-bar buttons: minimize, maximize/restore, smaller, larger.
pub(crate) fn resize(app: &AppHandle, shared: &Shared, action: &str) {
	let Some(studio) = window(app, STUDIO_LABEL) else { return };
	let Some((monitor, (position, size))) = bounds(&studio) else { return };
	match action {
		"minimize" => {
			let _ = studio.minimize();
		}
		// Wayland windows cannot place themselves, so the compositor maximizes and restores.
		"maximize" if wayland_session() => {
			let _ = if studio.is_maximized().unwrap_or(false) { studio.unmaximize() } else { studio.maximize() };
		}
		"maximize" => {
			let restore = shared.state.lock().unwrap().studio.restore.take();
			match restore {
				Some(bounds) => set_bounds(&studio, fit(&monitor, bounds)),
				None => {
					shared.state.lock().unwrap().studio.restore = Some((position, size));
					let area = monitor.work_area();
					set_bounds(&studio, (area.position, area.size));
				}
			}
		}
		"smaller" | "larger" => {
			let factor = if action == "larger" { ZOOM_STEP } else { 1.0 / ZOOM_STEP };
			shared.state.lock().unwrap().studio.restore = None;
			let size = PhysicalSize::new((size.width as f64 * factor) as u32, (size.height as f64 * factor) as u32);
			set_bounds(&studio, fit(&monitor, (position, size)));
		}
		_ => {}
	}
}

/// The studio is frameless; its edge handles report pointer deltas in CSS pixels.
#[tauri::command]
pub(crate) fn resize_studio_edge(app: AppHandle, shared: tauri::State<Shared>, edge: String, dx: f64, dy: f64) {
	let Some(studio) = window(&app, STUDIO_LABEL) else { return };
	let (Some((monitor, (position, size))), Ok(scale)) = (bounds(&studio), studio.scale_factor()) else {
		return;
	};
	if !dx.is_finite() || !dy.is_finite() {
		return;
	}
	shared.state.lock().unwrap().studio.restore = None;
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
	set_bounds(&studio, fit(&monitor, bounds));
}
