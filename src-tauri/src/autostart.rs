//! "Launch at Startup": registers the app to start when the user logs in.
//!
//! Windows: a value under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.
//! macOS: a LaunchAgent in `~/Library/LaunchAgents`.
//! Linux: an XDG autostart entry in `$XDG_CONFIG_HOME/autostart` (works on every desktop that follows
//! the freedesktop autostart spec: GNOME, KDE, Xfce, …).
//!
//! Only the current user is touched; nothing needs administrator rights.

use std::path::PathBuf;

#[cfg(windows)]
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(windows)]
const RUN_VALUE: &str = "Wuwa Tappo";
#[cfg(target_os = "linux")]
const DESKTOP_FILE: &str = "wuwa-tappo.desktop";
/// The packaged binary's name (nix `mainProgram`, deb/rpm `/usr/bin` entry).
#[cfg(target_os = "linux")]
const PROGRAM: &str = "wuwa-tappo";

/// Registers or unregisters the app. Disabling an entry that does not exist succeeds.
pub fn set(enabled: bool) -> Result<(), String> {
	if enabled {
		register(&launch_command()?)
	} else {
		unregister()
	}
}

/// Re-registers on launch while enabled, so the entry follows the app when it moves or is updated
/// (an AppImage renamed, a new /nix/store path, …).
pub fn refresh(enabled: bool) {
	if enabled {
		if let Err(error) = set(true) {
			eprintln!("autostart: {error}");
		}
	}
}

/// The executable to start at login.
fn launch_command() -> Result<PathBuf, String> {
	// An AppImage runs from a temporary mount; the image itself is what must be started.
	#[cfg(target_os = "linux")]
	if let Some(image) = std::env::var_os("APPIMAGE").filter(|path| !path.is_empty()) {
		return Ok(PathBuf::from(image));
	}
	let exe = std::env::current_exe().map_err(|error| format!("cannot find the app's executable: {error}"))?;
	// Nix store paths change with every update; the profile's command on PATH does not.
	#[cfg(target_os = "linux")]
	if exe.starts_with("/nix/store") && on_path(PROGRAM) {
		return Ok(PathBuf::from(PROGRAM));
	}
	Ok(exe)
}

#[cfg(target_os = "linux")]
fn on_path(program: &str) -> bool {
	std::env::var_os("PATH")
		.is_some_and(|paths| std::env::split_paths(&paths).any(|directory| directory.join(program).is_file()))
}

/* -------------------------------- Windows -------------------------------- */

#[cfg(windows)]
fn reg(arguments: &[&str]) -> Result<std::process::Output, String> {
	use std::os::windows::process::CommandExt;
	const CREATE_NO_WINDOW: u32 = 0x0800_0000;
	std::process::Command::new("reg")
		.args(arguments)
		.creation_flags(CREATE_NO_WINDOW)
		.output()
		.map_err(|error| format!("cannot run reg.exe: {error}"))
}

#[cfg(windows)]
fn register(exe: &std::path::Path) -> Result<(), String> {
	let command = format!("\"{}\"", exe.display());
	let output = reg(&["add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", &command, "/f"])?;
	if output.status.success() {
		Ok(())
	} else {
		Err(format!("reg add failed: {}", String::from_utf8_lossy(&output.stderr).trim()))
	}
}

#[cfg(windows)]
fn unregister() -> Result<(), String> {
	// Deleting a value that is not there fails; only a value that is still there is an error.
	let _ = reg(&["delete", RUN_KEY, "/v", RUN_VALUE, "/f"])?;
	let still_there = reg(&["query", RUN_KEY, "/v", RUN_VALUE])?.status.success();
	if still_there {
		Err("cannot remove the startup entry from the registry".into())
	} else {
		Ok(())
	}
}

/* --------------------------------- macOS --------------------------------- */

#[cfg(target_os = "macos")]
fn agent_path() -> Result<PathBuf, String> {
	let home = dirs::home_dir().ok_or("no home directory")?;
	Ok(home.join("Library/LaunchAgents").join(format!("{}.plist", agent_label())))
}

#[cfg(target_os = "macos")]
fn register(exe: &std::path::Path) -> Result<(), String> {
	let path = agent_path()?;
	write_file(&path, &launch_agent(&exe.to_string_lossy()))
}

#[cfg(target_os = "macos")]
fn unregister() -> Result<(), String> {
	remove_file(&agent_path()?)
}

/// A LaunchAgent that starts the app once at login, without keeping it alive after "Exit".
#[cfg(any(target_os = "macos", test))]
fn launch_agent(exe: &str) -> String {
	format!(
		r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>{label}</string>
	<key>ProgramArguments</key>
	<array>
		<string>{exe}</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<false/>
	<key>ProcessType</key>
	<string>Interactive</string>
</dict>
</plist>
"#,
		label = xml_escape(agent_label()),
		exe = xml_escape(exe),
	)
}

#[cfg(any(target_os = "macos", test))]
fn agent_label() -> &'static str {
	"com.asakiyuki.wuwa-tappo"
}

#[cfg(any(target_os = "macos", test))]
fn xml_escape(text: &str) -> String {
	text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/* --------------------------------- Linux --------------------------------- */

#[cfg(target_os = "linux")]
fn desktop_path() -> Result<PathBuf, String> {
	let config = dirs::config_dir().ok_or("no config directory")?;
	Ok(config.join("autostart").join(DESKTOP_FILE))
}

#[cfg(target_os = "linux")]
fn register(exe: &std::path::Path) -> Result<(), String> {
	write_file(&desktop_path()?, &desktop_entry(&exe.to_string_lossy()))
}

#[cfg(target_os = "linux")]
fn unregister() -> Result<(), String> {
	remove_file(&desktop_path()?)
}

/// An XDG autostart entry. `Exec` quotes the path, escaping what the desktop-entry spec reserves.
#[cfg(any(target_os = "linux", test))]
fn desktop_entry(exe: &str) -> String {
	let quoted = exe.replace('\\', "\\\\").replace('"', "\\\"").replace('`', "\\`").replace('$', "\\$").replace('%', "%%");
	format!(
		"[Desktop Entry]\nType=Application\nName=Wuwa Tappo\nComment=Desktop companion\nExec=\"{quoted}\"\nTerminal=false\nX-GNOME-Autostart-enabled=true\n"
	)
}

/* -------------------------------- shared --------------------------------- */

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn write_file(path: &std::path::Path, content: &str) -> Result<(), String> {
	if let Some(directory) = path.parent() {
		std::fs::create_dir_all(directory).map_err(|error| format!("cannot create {}: {error}", directory.display()))?;
	}
	std::fs::write(path, content).map_err(|error| format!("cannot write {}: {error}", path.display()))
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn remove_file(path: &std::path::Path) -> Result<(), String> {
	match std::fs::remove_file(path) {
		Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
			Err(format!("cannot remove {}: {error}", path.display()))
		}
		_ => Ok(()),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn desktop_entry_quotes_the_path_and_escapes_reserved_characters() {
		let entry = desktop_entry("/home/me/Apps/Wuwa Tappo $1 \"x\" 100%.AppImage");
		assert!(entry.starts_with("[Desktop Entry]\n"));
		assert!(entry.contains("Exec=\"/home/me/Apps/Wuwa Tappo \\$1 \\\"x\\\" 100%%.AppImage\"\n"));
		assert!(entry.contains("Type=Application\n"));
	}

	#[test]
	fn launch_agent_escapes_the_path_and_does_not_keep_the_app_alive() {
		let agent = launch_agent("/Applications/A & B <x>.app/Contents/MacOS/wuwa-tappo");
		assert!(agent.contains("<string>/Applications/A &amp; B &lt;x&gt;.app/Contents/MacOS/wuwa-tappo</string>"));
		assert!(agent.contains("<key>RunAtLoad</key>\n\t<true/>"));
		assert!(agent.contains("<key>KeepAlive</key>\n\t<false/>"));
		assert!(agent.contains(&format!("<string>{}</string>", agent_label())));
	}
}
