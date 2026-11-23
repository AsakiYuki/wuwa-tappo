//! Linux tray as a StatusNotifierItem (ksni). Tauri's own tray goes through libappindicator, which
//! never reports clicks on the icon; this one does, so a click opens the studio like the Electron
//! app. The menu comes from the same `tray::items` as the Tauri tray.
//!
//! ksni's blocking API drives its own Tokio runtime, which must not be entered from another
//! runtime's thread (Tauri's async commands), so every call into it runs on a plain thread.

use crate::tray::{self, TrayAction};
use crate::Shared;
use ksni::blocking::{Handle, TrayMethods};
use ksni::menu::{CheckmarkItem, StandardItem};
use std::sync::OnceLock;
use tauri::AppHandle;

static HANDLE: OnceLock<Handle<PetTray>> = OnceLock::new();

pub struct PetTray {
	app: AppHandle,
	shared: Shared,
	icon: Vec<ksni::Icon>,
}

impl PetTray {
	/// Runs a menu action off ksni's thread: the action may update the tray, which waits for it.
	fn run(&self, action: TrayAction) {
		let (app, shared) = (self.app.clone(), self.shared.clone());
		std::thread::spawn(move || tray::action(&app, &shared, action));
	}
}

impl ksni::Tray for PetTray {
	fn id(&self) -> String {
		"wuwa-tappo".into()
	}

	fn title(&self) -> String {
		"Wuwa Tappo".into()
	}

	fn icon_pixmap(&self) -> Vec<ksni::Icon> {
		self.icon.clone()
	}

	fn tool_tip(&self) -> ksni::ToolTip {
		ksni::ToolTip { title: "Wuwa Tappo · Desktop Companion".into(), ..Default::default() }
	}

	/// Left click on the icon.
	fn activate(&mut self, _x: i32, _y: i32) {
		self.run(TrayAction::Studio);
	}

	fn menu(&self) -> Vec<ksni::MenuItem<Self>> {
		let mut menu = Vec::new();
		for item in tray::items(&self.shared) {
			if item.separator_before {
				menu.push(ksni::MenuItem::Separator);
			}
			let action = item.action;
			let activate = Box::new(move |tray: &mut Self| tray.run(action));
			menu.push(match item.checked {
				Some(checked) => CheckmarkItem { label: item.label.into(), checked, activate, ..Default::default() }.into(),
				None => StandardItem { label: item.label.into(), activate, ..Default::default() }.into(),
			});
		}
		menu
	}
}

/// The app icon as ARGB32 in network byte order, as StatusNotifierItem expects.
fn icon(app: &AppHandle) -> Vec<ksni::Icon> {
	let Some(image) = app.default_window_icon() else { return Vec::new() };
	let data = image.rgba().chunks_exact(4).flat_map(|pixel| [pixel[3], pixel[0], pixel[1], pixel[2]]).collect();
	vec![ksni::Icon { width: image.width() as i32, height: image.height() as i32, data }]
}

/// Starts the tray; false when no StatusNotifierItem host answers (e.g. GNOME without the
/// AppIndicator extension), so the caller can fall back to Tauri's tray.
pub fn start(app: &AppHandle, shared: &Shared) -> bool {
	let tray = PetTray { app: app.clone(), shared: shared.clone(), icon: icon(app) };
	let spawned = std::thread::spawn(move || tray.spawn()).join();
	match spawned {
		Ok(Ok(handle)) => HANDLE.set(handle).is_ok(),
		Ok(Err(error)) => {
			eprintln!("tray: StatusNotifierItem unavailable ({error}); using the fallback tray");
			false
		}
		Err(_) => false,
	}
}

/// Re-reads the menu (check marks, the permission item). False if this tray is not running.
pub fn refresh() -> bool {
	if HANDLE.get().is_none() {
		return false;
	}
	std::thread::spawn(|| {
		if let Some(handle) = HANDLE.get() {
			handle.update(|_| {});
		}
	});
	true
}
