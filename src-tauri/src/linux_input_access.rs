//! The tray's "Fix Input Permissions": grants this user read access to /dev/input after an explicit
//! warning. evdev rescans every second, so the pet reacts as soon as the access is granted.

use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

/// Where pkexec and setfacl may come from. Never $PATH: any program running as the user can put a
/// directory in front of it, and a planted `setfacl` would then run as root behind the polkit prompt.
/// /run/wrappers/bin and /run/current-system/sw/bin are NixOS's.
const SYSTEM_DIRECTORIES: [&str; 6] = ["/run/wrappers/bin", "/run/current-system/sw/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];

/// The real path of a system executable that only root can change. That path, not the symlink that
/// led to it, is what gets run, so the link cannot be swapped in between.
fn system_executable(name: &str) -> Option<PathBuf> {
	SYSTEM_DIRECTORIES
		.iter()
		.filter_map(|directory| std::fs::canonicalize(Path::new(directory).join(name)).ok())
		.find(|path| path.is_file() && root_controlled(path))
}

/// The file and every directory above it belong to root and nobody else can write to them; a
/// directory others may write to counts only with the sticky bit, which keeps them from replacing
/// root's entries (the Nix store).
fn root_controlled(path: &Path) -> bool {
	path.ancestors().all(|entry| {
		let Ok(metadata) = std::fs::metadata(entry) else { return false };
		let mode = metadata.permissions().mode();
		let shared_write = mode & 0o022 != 0;
		let sticky_directory = metadata.is_dir() && mode & 0o1000 != 0;
		metadata.uid() == 0 && (!shared_write || sticky_directory)
	})
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

/// This process's user id, from the kernel (/proc/self belongs to it). Not `id -un`, which runs
/// whatever `id` comes first in $PATH, nor the spoofable $USER.
fn user_id() -> Option<u32> {
	std::fs::metadata("/proc/self").ok().map(|metadata| metadata.uid())
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
		let (Some(pkexec), Some(setfacl)) = (system_executable("pkexec"), system_executable("setfacl")) else {
			return help(&app, "pkexec (polkit) or setfacl (acl) is not installed.");
		};
		let Some(user) = user_id() else { return help(&app, "Could not determine the user id.") };
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

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn executables_outside_root_controlled_directories_are_refused() {
		let directory = std::env::temp_dir().join(format!("wuwa-tappo-test-{}", std::process::id()));
		std::fs::create_dir_all(&directory).unwrap();
		let planted = directory.join("setfacl");
		std::fs::write(&planted, "#!/bin/sh\n").unwrap();
		std::fs::set_permissions(&planted, std::fs::Permissions::from_mode(0o755)).unwrap();
		assert!(!root_controlled(&planted), "a file the user owns is not trusted");
		std::fs::remove_dir_all(&directory).unwrap();
		assert!(root_controlled(Path::new("/")));
	}

	#[test]
	fn system_executables_resolve_to_root_owned_files() {
		// `sh` exists on every Linux system, in a root-owned directory.
		let sh = system_executable("sh").expect("sh is found");
		assert!(sh.is_absolute() && root_controlled(&sh));
		assert_eq!(system_executable("definitely-not-a-real-tool"), None);
	}
}
