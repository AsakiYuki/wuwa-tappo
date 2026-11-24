//! The pages' IPC: `petAPI.init()` and every `petAPI.command(name, argument)` (src/node/commands.ts).

use crate::{
	broadcast_state, input, pet, refresh_cache, save_now, setting_bool, settings, status, studio, Shared, CATALOG_JSON,
	PET_LABEL, SAVE_FAILED,
};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::DialogExt;

/// The pet window may only open the studio, play emotes and report clicks (src/node/main.ts).
const PET_COMMANDS: [&str; 3] = ["tap", "emote", "open"];
/// Saves are ~30 KB; anything far larger is not one, and is not read into memory.
const MAX_IMPORT_BYTES: u64 = 8 * 1024 * 1024;

#[tauri::command]
pub(crate) fn init(app: AppHandle, shared: tauri::State<Shared>) -> Value {
	// Parsed per call (once per page load) rather than kept: the catalog is only needed here.
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

/// Every `petAPI.command(name, argument)` call, from either window.
#[tauri::command]
pub(crate) async fn command(
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
		let not_a_save = || Ok(json!({ "ok": false, "error": "This file is not a valid Wuwa Tappo save" }));
		if std::fs::metadata(&path).map_or(true, |metadata| metadata.len() > MAX_IMPORT_BYTES) {
			return not_a_save();
		}
		match std::fs::read_to_string(path) {
			Ok(text) => Value::String(text),
			Err(_) => return not_a_save(),
		}
	} else {
		argument
	};
	let reply = shared.backend.lock().unwrap().command(&name, &argument);
	Ok(finish_state_command(&app, &shared, &name, &reply))
}

/// Commands that only act on windows or the OS; `None` means `name` changes the collection instead.
fn action_command(app: &AppHandle, shared: &Shared, name: &str, argument: &Value) -> Option<Result<Value, String>> {
	let done = Some(Ok(Value::Null));
	match name {
		"open" => {
			studio::show(app, shared, argument.as_str().map(String::from));
			done
		}
		"hide" => {
			studio::close(app);
			done
		}
		"window" => {
			studio::resize(app, shared, argument.as_str().unwrap_or(""));
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
			pet::reset(app, shared);
			done
		}
		// Clicking the pet counts as a tap only when no global hook already reported the click.
		"tap" => {
			if !input::hook_status(shared).contains("connected") {
				input::handle(app, shared, "MouseLeft".into(), true, "left");
				input::handle(app, shared, "MouseLeft".into(), false, "left");
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
			pet::apply_settings(app, shared, reply.get("previousSettings"));
		}
		"import-data" | "reset-data" => {
			refresh_cache(shared);
			pet::apply_settings(app, shared, None);
			pet::place(app, shared, name == "reset-data");
		}
		_ => {}
	}
	let saved = save_now(app, shared);
	broadcast_state(app, &refresh_cache(shared));
	let warning = if saved { String::new() } else { SAVE_FAILED.to_string() };
	json!({ "ok": true, "result": reply["result"], "warning": warning })
}

/// Changes a boolean setting (from the tray), saves it and syncs every window.
pub(crate) fn toggle_setting(app: &AppHandle, shared: &Shared, key: &str) {
	let enabled = !setting_bool(&settings(shared), key, key != "passthrough");
	let reply = shared.backend.lock().unwrap().command("settings", &json!({ key: enabled }));
	finish_state_command(app, shared, "settings", &reply);
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
