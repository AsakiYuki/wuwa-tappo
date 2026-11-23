//! The tray: the Electron tray's items (src/node/main.ts), shown by Tauri's tray on Windows and macOS
//! and by a StatusNotifierItem on Linux (`linux_tray.rs`), with Tauri's as the fallback there.

#[cfg(target_os = "linux")]
use crate::linux_tray;
#[cfg(target_os = "macos")]
use crate::macos_input;
use crate::{commands, pet, setting_bool, settings, studio, Shared};
use std::sync::atomic::Ordering;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::AppHandle;

const TRAY_ID: &str = "main";

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

pub fn items(shared: &Shared) -> Vec<TrayItem> {
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
	if cfg!(target_os = "macos") && shared.state.lock().unwrap().hook_error.is_some() {
		items.push(item(TrayAction::FixInput, "⚡ Open Input Monitoring Settings (macOS)", None, false));
	}
	items.push(item(TrayAction::Quit, "Exit Wuwa Tappo", None, true));
	items
}

pub fn action(app: &AppHandle, shared: &Shared, action: TrayAction) {
	match action {
		TrayAction::Studio => studio::show(app, shared, None),
		TrayAction::ShowPet => pet::reset(app, shared),
		TrayAction::Passthrough => commands::toggle_setting(app, shared, "passthrough"),
		TrayAction::Input => commands::toggle_setting(app, shared, "inputEnabled"),
		#[cfg(target_os = "linux")]
		TrayAction::FixInput => crate::linux_input_access::grant(app.clone()),
		#[cfg(target_os = "macos")]
		TrayAction::FixInput => {
			let _ = std::process::Command::new("open").arg(macos_input::INPUT_MONITORING_SETTINGS).spawn();
		}
		#[cfg(windows)]
		TrayAction::FixInput => {}
		TrayAction::Quit => app.exit(0),
	}
}

fn menu(app: &AppHandle, shared: &Shared) -> tauri::Result<Menu<tauri::Wry>> {
	let menu = Menu::new(app)?;
	for (index, item) in items(shared).into_iter().enumerate() {
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
pub(crate) fn refresh(app: &AppHandle, shared: &Shared) {
	#[cfg(target_os = "linux")]
	if linux_tray::refresh() {
		return;
	}
	let (handle, shared) = (app.clone(), shared.clone());
	let _ = app.run_on_main_thread(move || {
		let Some(tray) = handle.tray_by_id(TRAY_ID) else { return };
		if let Ok(menu) = menu(&handle, &shared) {
			let _ = tray.set_menu(Some(menu));
		}
	});
}

/// Tauri's tray: left click opens the studio, right click shows the menu (Windows, macOS). On Linux
/// it is the fallback when no StatusNotifierItem host is running; clicks are not reported there.
fn create_tauri_tray(app: &AppHandle, shared: &Shared) -> tauri::Result<()> {
	let menu = menu(app, shared)?;
	let (menu_shared, click_shared) = (shared.clone(), shared.clone());
	TrayIconBuilder::with_id(TRAY_ID)
		.icon(app.default_window_icon().expect("bundle icon").clone())
		.tooltip("Wuwa Tappo · Desktop Companion")
		.menu(&menu)
		.show_menu_on_left_click(false)
		.on_menu_event(move |app, event| {
			let items = items(&menu_shared);
			if let Some(item) = event.id().as_ref().parse::<usize>().ok().and_then(|index| items.get(index)) {
				action(app, &menu_shared, item.action);
			}
		})
		.on_tray_icon_event(move |tray, event| {
			if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
				studio::show(tray.app_handle(), &click_shared, None);
			}
		})
		.build(app)?;
	Ok(())
}

pub(crate) fn create(app: &AppHandle, shared: &Shared) -> tauri::Result<()> {
	#[cfg(target_os = "linux")]
	if linux_tray::start(app, shared) {
		return Ok(());
	}
	create_tauri_tray(app, shared)
}
