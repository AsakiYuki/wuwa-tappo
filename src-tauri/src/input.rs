//! Global input: every key, mouse button and controller button taps the pet.
//!
//! Sources: rdev (keyboard/mouse hook) on Windows and Linux/X11, a CGEventTap on macOS, evdev on
//! Linux (also on Wayland; it reads controllers too), and the controller watchers (`gamepad.rs`).

#[cfg(target_os = "linux")]
use crate::evdev;
#[cfg(target_os = "macos")]
use crate::macos_input;
use crate::{broadcast_status, gamepad, save_later, save_now, setting_bool, tray, Shared, PET_LABEL};
use serde_json::json;
use std::sync::atomic::Ordering;
#[cfg(target_os = "macos")]
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const EMOTE_HOTKEYS: [&str; 5] = ["1", "2", "3", "4", "5"];

/// Starts every input source.
pub(crate) fn start(app: &AppHandle, shared: &Shared) {
	start_hook(app.clone(), shared.clone());
	#[cfg(target_os = "linux")]
	start_evdev(app, shared);
	let (app, shared) = (app.clone(), shared.clone());
	gamepad::start(move |key, down| {
		let side = gamepad::side(&key);
		handle(&app, &shared, key, down, side);
	});
}

/// The input status shown in the studio.
pub(crate) fn hook_status(shared: &Shared) -> String {
	if shared.devices.keyboard.load(Ordering::Relaxed) {
		return "Global input connected (evdev)".into();
	}
	if needs_input_access() {
		return "Wayland: Input permission required (tray menu → Fix Input Permissions)".into();
	}
	match &shared.state.lock().unwrap().hook_error {
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

/// One key or button going down or up, from any source.
pub(crate) fn handle(app: &AppHandle, shared: &Shared, key: String, down: bool, side: &str) {
	let (counted, hotkey_emote) = {
		let mut state = shared.state.lock().unwrap();
		if !setting_bool(&state.settings, "inputEnabled", true) {
			return;
		}
		if !down {
			state.pressed.remove(&key);
			(false, None)
		} else {
			// Key repeat: the OS resends keydown while held; only the first press counts.
			if !state.pressed.insert(key.clone()) {
				return;
			}
			let group = gamepad::trigger_group(&key);
			let same_trigger_held =
				group.is_some() && state.pressed.iter().any(|held| held != &key && gamepad::trigger_group(held) == group);
			// Ctrl/Meta+Alt+1…5 plays the emote in that slot.
			let modifiers = ["Ctrl", "CtrlRight", "Meta", "MetaRight"].iter().any(|held| state.pressed.contains(*held))
				&& ["Alt", "AltRight"].iter().any(|held| state.pressed.contains(*held));
			let slot = EMOTE_HOTKEYS.iter().position(|hotkey| *hotkey == key);
			let hotkey_emote = slot.filter(|_| modifiers).and_then(|slot| state.emotes.get(slot).cloned());
			(!same_trigger_held, hotkey_emote)
		}
	};

	if counted {
		let tap = shared.backend.lock().unwrap().tap();
		shared.state.lock().unwrap().counts = (tap["count"].clone(), tap["totalCount"].clone(), tap["dailyCount"].clone());
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
		let mut state = shared.state.lock().unwrap();
		state.serial += 1;
		json!({
			"key": key,
			"down": down,
			"side": side,
			"count": state.counts.0,
			"totalCount": state.counts.1,
			"dailyCount": state.counts.2,
			"countedTap": counted,
			"serial": state.serial,
		})
	};
	let _ = app.emit_to(PET_LABEL, "input", message);
	if let Some(emote) = hotkey_emote {
		let _ = app.emit_to(PET_LABEL, "emote", emote);
	}
}

/// Tells every window about a new input status and updates the tray's permission item.
fn status_changed(app: &AppHandle, shared: &Shared) {
	broadcast_status(app, shared);
	tray::refresh(app, shared);
}

/// Global keyboard and mouse hook on macOS. Without Input Monitoring the status says so (and the tray
/// offers the settings page); the hook starts once the permission is there.
#[cfg(target_os = "macos")]
fn start_hook(app: AppHandle, shared: Shared) {
	const PERMISSION_POLL: Duration = Duration::from_secs(2);
	const TAP_RETRY: Duration = Duration::from_secs(10);
	let set_error = |app: &AppHandle, shared: &Shared, error: Option<String>| {
		let changed = {
			let mut state = shared.state.lock().unwrap();
			std::mem::replace(&mut state.hook_error, error.clone()) != error
		};
		if changed {
			if let Some(error) = &error {
				eprintln!("{error}");
			}
			status_changed(app, shared);
		}
	};
	std::thread::spawn(move || loop {
		if macos_input::has_permission(false) {
			set_error(&app, &shared, None);
		}
		let (hook_app, hook_shared) = (app.clone(), shared.clone());
		let result = macos_input::listen(move |key, down, side| handle(&hook_app, &hook_shared, key, down, side));
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
fn start_hook(app: AppHandle, shared: Shared) {
	use crate::keys;
	let devices = shared.devices.clone();
	std::thread::spawn(move || {
		let hook_shared = shared.clone();
		let hook_app = app.clone();
		let result = rdev::listen(move |event| match event.event_type {
			rdev::EventType::KeyPress(_) | rdev::EventType::KeyRelease(_) if devices.keyboard.load(Ordering::Relaxed) => {}
			rdev::EventType::ButtonPress(_) | rdev::EventType::ButtonRelease(_)
				if devices.mouse.load(Ordering::Relaxed) => {}
			rdev::EventType::KeyPress(key) | rdev::EventType::KeyRelease(key) => {
				let name = keys::key_name(key);
				let side = keys::keyboard_side(&name);
				let down = matches!(event.event_type, rdev::EventType::KeyPress(_));
				handle(&hook_app, &hook_shared, name, down, side);
			}
			rdev::EventType::ButtonPress(button) | rdev::EventType::ButtonRelease(button) => {
				if let Some(name) = keys::mouse_name(button) {
					let down = matches!(event.event_type, rdev::EventType::ButtonPress(_));
					handle(&hook_app, &hook_shared, name.into(), down, keys::mouse_side(name));
				}
			}
			_ => {}
		});
		// listen() only returns on failure.
		let error = format!("Global input hook failed: {result:?}");
		eprintln!("{error}");
		shared.state.lock().unwrap().hook_error = Some(error);
		status_changed(&app, &shared);
	});
}

#[cfg(target_os = "linux")]
fn start_evdev(app: &AppHandle, shared: &Shared) {
	let (input_app, input_shared) = (app.clone(), shared.clone());
	let touchpad_shared = shared.clone();
	let (changed_app, changed_shared) = (app.clone(), shared.clone());
	evdev::start(
		shared.devices.clone(),
		evdev::Callbacks {
			input: Box::new(move |key, down, side| handle(&input_app, &input_shared, key, down, side)),
			touchpad_input: Box::new(move || setting_bool(&crate::settings(&touchpad_shared), "touchpadInput", false)),
			devices_changed: Box::new(move || status_changed(&changed_app, &changed_shared)),
		},
	);
}
