//! The tray's "Fix Input Permissions": grants this user read access to /dev/input after an explicit
//! warning, like the Electron app (src/node/main.ts). evdev rescans every second, so the pet reacts
//! as soon as the access is granted.

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
