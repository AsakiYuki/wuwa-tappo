//! Controller input through the watchers the Electron app also runs (src/node/input-manager.ts):
//! XInput on Windows (src/native/win-gamepad-watcher.c) and IOKit HID on macOS
//! (src/native/mac-gamepad-watcher.c). Linux controllers are read through evdev instead
//! (`evdev.rs`), which shares the button names below.
//!
//! Watcher lines are `GamepadN \t evdev-code \t 0|1`; `STATUS:` lines are informational. It exits on
//! its own once the process whose PID it was given is gone, even after a crash.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};

const WATCHER: &str = if cfg!(windows) { "win-gamepad-watcher.exe" } else { "mac-gamepad-watcher" };

/// Linux evdev button codes the watcher reports (LINUX_GAMEPAD_BUTTONS in src/node/input-keymaps.ts).
pub fn button_name(code: u32) -> String {
	let name = match code {
		288 => "Trigger",
		289 => "Trigger2",
		290 => "Thumb",
		291 => "Thumb2",
		292 => "Top",
		293 => "Top2",
		294 => "Pinkie",
		295 => "Base",
		296 => "Base2",
		297 => "Base3",
		298 => "Base4",
		299 => "Base5",
		300 => "Base6",
		304 => "South",
		305 => "East",
		306 => "C",
		307 => "North",
		308 => "West",
		310 => "L1",
		311 => "R1",
		312 => "L2",
		313 => "R2",
		314 => "Select",
		315 => "Start",
		316 => "Mode",
		317 => "L3",
		318 => "R3",
		544 => "DPadUp",
		545 => "DPadDown",
		546 => "DPadLeft",
		547 => "DPadRight",
		_ => return format!("Button{code}"),
	};
	name.to_string()
}

/// Same rule as `gamepadSide` in src/node/input-keymaps.ts.
pub fn side(key: &str) -> &'static str {
	let button = key.rsplit(':').next().unwrap_or(key);
	let left = button.starts_with("DPad") || button.starts_with("LeftTriggerAxis") || matches!(button, "L1" | "L2" | "L3");
	if left { "left" } else { "right" }
}

/// Analog and digital triggers of one pad report the same press; grouping them lets only one count
/// (`gamepadTriggerGroup` in src/node/input-keymaps.ts).
pub fn trigger_group(key: &str) -> Option<String> {
	let (pad, button) = key.split_once(':')?;
	if !pad.starts_with("Gamepad") {
		return None;
	}
	let group = match button {
		"L2" | "LeftTriggerAxisPositive" => "LT",
		"R2" | "RightTriggerAxisPositive" => "RT",
		_ => return None,
	};
	Some(format!("{pad}:{group}"))
}

/// Parses one watcher line into `(key, down)`.
fn parse_line(line: &str) -> Option<(String, bool)> {
	let line = line.trim();
	if line.is_empty() || line.starts_with("STATUS:") {
		return None;
	}
	let parts: Vec<&str> = line.split('\t').collect();
	match parts.as_slice() {
		[pad, code, state] => Some((format!("{pad}:{}", button_name(code.parse().ok()?)), *state == "1")),
		[key, state] => Some((key.to_string(), *state == "1")),
		_ => None,
	}
}

/// Next to the executable once bundled (on macOS in Contents/MacOS); the repo's assets/bin during
/// development.
fn find_watcher() -> Option<PathBuf> {
	let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
	let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("assets").join("bin");
	[exe_dir.clone(), exe_dir.join("bin"), dev].into_iter().map(|dir| dir.join(WATCHER)).find(|path| path.exists())
}

/// Starts the watcher and calls `on_input(key, down)` for every button change. Returns false if it
/// could not start (not on Windows or macOS, binary missing, spawn failed).
pub fn start(on_input: impl Fn(String, bool) + Send + 'static) -> bool {
	if !cfg!(any(windows, target_os = "macos")) {
		return false;
	}
	let Some(path) = find_watcher() else {
		eprintln!("gamepad: {WATCHER} not found");
		return false;
	};
	let mut command = Command::new(&path);
	command.arg(std::process::id().to_string()).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
	#[cfg(windows)]
	{
		use std::os::windows::process::CommandExt;
		const CREATE_NO_WINDOW: u32 = 0x0800_0000;
		command.creation_flags(CREATE_NO_WINDOW);
	}
	let mut child = match command.spawn() {
		Ok(child) => child,
		Err(error) => {
			eprintln!("gamepad: could not start {}: {error}", path.display());
			return false;
		}
	};
	let stdout = child.stdout.take().expect("piped stdout");
	std::thread::spawn(move || {
		for line in BufReader::new(stdout).lines().map_while(Result::ok) {
			if let Some((key, down)) = parse_line(&line) {
				on_input(key, down);
			}
		}
		let _ = child.wait();
	});
	true
}
