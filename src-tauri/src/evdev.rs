//! Linux global input through evdev (/dev/input/event*): keyboards, mice, touchpads and controllers.
//!
//! Unlike the X11 hook (rdev), evdev sees every key press on Wayland too. It needs read access to
//! the devices: controllers usually have it already (logind `uaccess`), keyboards and mice need
//! the tray's "Fix Input Permissions" or the udev rule in packaging/linux.

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{ErrorKind, Read};
use std::os::unix::fs::OpenOptionsExt;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

const EVENT_SIZE: usize = 24;
const EV_SYN: u16 = 0;
const EV_KEY: u16 = 1;
const EV_ABS: u16 = 3;
const SYN_DROPPED: u16 = 3;
const BTN_TOUCH: u16 = 330;
const O_NONBLOCK: i32 = 0o4000;
const POLL: Duration = Duration::from_millis(8);
const RESCAN: Duration = Duration::from_secs(1);

pub struct Callbacks {
	/// `(key, down, side)` for every press and release.
	pub input: Box<dyn Fn(String, bool, &'static str) + Send>,
	/// Whether touchpad touches count as taps (the `touchpadInput` setting).
	pub touchpad_input: Box<dyn Fn() -> bool + Send>,
	/// Called when the set of open keyboards / mice changes.
	pub devices_changed: Box<dyn Fn() + Send>,
}

struct Device {
	path: String,
	file: File,
	keyboard: bool,
	mouse: bool,
	touchpad: bool,
	/// "GamepadN" for controllers, empty otherwise.
	gamepad: String,
	axes: HashMap<u16, &'static str>,
	leftover: Vec<u8>,
}

struct Candidate {
	keyboard: bool,
	mouse: bool,
	touchpad: bool,
	gamepad: bool,
}

fn key_name(code: u16) -> String {
	let name = match code {
		1 => "Escape",
		2 => "1",
		3 => "2",
		4 => "3",
		5 => "4",
		6 => "5",
		7 => "6",
		8 => "7",
		9 => "8",
		10 => "9",
		11 => "0",
		12 => "Minus",
		13 => "Equal",
		14 => "Backspace",
		15 => "Tab",
		16 => "Q",
		17 => "W",
		18 => "E",
		19 => "R",
		20 => "T",
		21 => "Y",
		22 => "U",
		23 => "I",
		24 => "O",
		25 => "P",
		26 => "BracketLeft",
		27 => "BracketRight",
		28 => "Enter",
		29 => "Ctrl",
		30 => "A",
		31 => "S",
		32 => "D",
		33 => "F",
		34 => "G",
		35 => "H",
		36 => "J",
		37 => "K",
		38 => "L",
		39 => "Semicolon",
		40 => "Quote",
		41 => "Backquote",
		42 => "Shift",
		43 => "Backslash",
		44 => "Z",
		45 => "X",
		46 => "C",
		47 => "V",
		48 => "B",
		49 => "N",
		50 => "M",
		51 => "Comma",
		52 => "Period",
		53 => "Slash",
		54 => "ShiftRight",
		56 => "Alt",
		57 => "Space",
		58 => "CapsLock",
		59 => "F1",
		60 => "F2",
		61 => "F3",
		62 => "F4",
		63 => "F5",
		64 => "F6",
		65 => "F7",
		66 => "F8",
		67 => "F9",
		68 => "F10",
		87 => "F11",
		88 => "F12",
		97 => "CtrlRight",
		100 => "AltRight",
		102 => "Home",
		103 => "ArrowUp",
		104 => "PageUp",
		105 => "ArrowLeft",
		106 => "ArrowRight",
		107 => "End",
		108 => "ArrowDown",
		109 => "PageDown",
		110 => "Insert",
		111 => "Delete",
		125 => "Meta",
		126 => "MetaRight",
		_ => return format!("Key{code}"),
	};
	name.to_string()
}

fn mouse_name(code: u16) -> Option<&'static str> {
	Some(match code {
		272 => "MouseLeft",
		273 => "MouseRight",
		274 => "MouseMiddle",
		275 => "MouseBack",
		276 => "MouseForward",
		277 => "MouseForward",
		278 => "MouseBack",
		_ => return None,
	})
}

fn axis_name(code: u16) -> Option<&'static str> {
	// Analog sticks never tap, so only triggers and the D-pad hat are read.
	match code {
		2 => Some("LeftTriggerAxis"),
		5 => Some("RightTriggerAxis"),
		16 => Some("DPadX"),
		17 => Some("DPadY"),
		_ => None,
	}
}

fn contains_word(haystack: &str, word: &str) -> bool {
	haystack.split_whitespace().any(|token| token == word)
}

/// Readable input devices worth opening, from /proc/bus/input/devices.
fn candidates() -> HashMap<String, Candidate> {
	let mut found = HashMap::new();
	let Ok(text) = std::fs::read_to_string("/proc/bus/input/devices") else { return found };
	for block in text.split("\n\n") {
		let field = |prefix: &str| {
			block.lines().find_map(|line| line.strip_prefix(prefix)).unwrap_or("").to_string()
		};
		let handlers = field("H: Handlers=");
		let name = field("N: Name=").trim_matches('"').to_lowercase();
		let gamepad = handlers.split_whitespace().any(|h| h.starts_with("js") && h[2..].parse::<u32>().is_ok())
			|| ["gamepad", "joystick", "controller", "xbox", "x-box", "dualsense", "dualshock", "joycon", "joy-con"]
				.iter()
				.any(|word| name.contains(word));
		let touchpad =
			["touchpad", "trackpad", "synaptics", "elan", "alps", "glidepoint"].iter().any(|word| name.contains(word));
		let keyboard = contains_word(&handlers, "kbd");
		let mouse = handlers.split_whitespace().any(|h| h.starts_with("mouse"));
		if !gamepad && !touchpad && !keyboard && !mouse {
			continue;
		}
		let Some(event) = handlers.split_whitespace().find(|h| h.starts_with("event") && h[5..].parse::<u32>().is_ok())
		else {
			continue;
		};
		found.insert(format!("/dev/input/{event}"), Candidate { keyboard, mouse, touchpad, gamepad });
	}
	found
}

struct Reader {
	devices: Vec<Device>,
	next_gamepad: u32,
	callbacks: Callbacks,
	status: Arc<crate::InputDevices>,
	/// Keys this reader reported as held, so a vanished device can release them.
	held: HashSet<String>,
}

impl Reader {
	fn emit(&mut self, key: String, down: bool, side: &'static str) {
		if down {
			self.held.insert(key.clone());
		} else if !self.held.remove(&key) {
			return;
		}
		(self.callbacks.input)(key, down, side);
	}

	fn release_prefix(&mut self, prefix: &str) {
		let keys: Vec<String> = self.held.iter().filter(|key| key.starts_with(prefix)).cloned().collect();
		for key in keys {
			let side = if prefix.is_empty() { crate::keys::keyboard_side(&key) } else { crate::gamepad::side(&key) };
			self.emit(key, false, side);
		}
	}

	fn rescan(&mut self) {
		let found = candidates();
		let before = (self.status.keyboard.load(Ordering::Relaxed), self.status.mouse.load(Ordering::Relaxed));

		let gone: Vec<usize> =
			(0..self.devices.len()).rev().filter(|&i| !found.contains_key(&self.devices[i].path)).collect();
		for index in gone {
			let device = self.devices.remove(index);
			if !device.gamepad.is_empty() {
				self.release_prefix(&format!("{}:", device.gamepad));
			}
		}

		for (path, candidate) in found {
			if self.devices.iter().any(|device| device.path == path) {
				continue;
			}
			let Ok(file) = std::fs::OpenOptions::new().read(true).custom_flags(O_NONBLOCK).open(&path) else { continue };
			let gamepad = if candidate.gamepad {
				self.next_gamepad += 1;
				format!("Gamepad{}", self.next_gamepad)
			} else {
				String::new()
			};
			self.devices.push(Device {
				path,
				file,
				keyboard: candidate.keyboard,
				mouse: candidate.mouse,
				touchpad: candidate.touchpad,
				gamepad,
				axes: HashMap::new(),
				leftover: Vec::new(),
			});
		}

		let keyboard = self.devices.iter().any(|device| device.keyboard && device.gamepad.is_empty());
		let mouse = self.devices.iter().any(|device| (device.mouse || device.touchpad) && device.gamepad.is_empty());
		self.status.keyboard.store(keyboard, Ordering::Relaxed);
		self.status.mouse.store(mouse, Ordering::Relaxed);
		if (keyboard, mouse) != before {
			(self.callbacks.devices_changed)();
		}
	}

	fn poll(&mut self) {
		let mut buffer = [0u8; 4096];
		let mut index = 0;
		while index < self.devices.len() {
			let mut failed = false;
			loop {
				match self.devices[index].file.read(&mut buffer) {
					Ok(0) => break,
					Ok(size) => {
						let mut data = std::mem::take(&mut self.devices[index].leftover);
						data.extend_from_slice(&buffer[..size]);
						let whole = data.len() - data.len() % EVENT_SIZE;
						for event in data[..whole].chunks_exact(EVENT_SIZE) {
							let kind = u16::from_le_bytes([event[16], event[17]]);
							let code = u16::from_le_bytes([event[18], event[19]]);
							let value = i32::from_le_bytes([event[20], event[21], event[22], event[23]]);
							self.handle(index, kind, code, value);
						}
						self.devices[index].leftover = data[whole..].to_vec();
					}
					Err(error) if error.kind() == ErrorKind::WouldBlock => break,
					Err(_) => {
						failed = true;
						break;
					}
				}
			}
			if failed {
				// Unplugged; the next rescan forgets it and releases its buttons.
				let device = self.devices.remove(index);
				if !device.gamepad.is_empty() {
					self.release_prefix(&format!("{}:", device.gamepad));
				}
				continue;
			}
			index += 1;
		}
	}

	fn handle(&mut self, index: usize, kind: u16, code: u16, value: i32) {
		if kind == EV_SYN && code == SYN_DROPPED {
			// The kernel dropped events; whatever was held may have been released meanwhile.
			self.release_prefix("");
			return;
		}
		let gamepad = self.devices[index].gamepad.clone();
		if !gamepad.is_empty() && kind == EV_ABS {
			self.handle_axis(index, &gamepad, code, value);
			return;
		}
		if kind != EV_KEY || (value != 0 && value != 1) {
			return;
		}
		let down = value == 1;
		if !gamepad.is_empty() {
			let key = format!("{gamepad}:{}", crate::gamepad::button_name(code as u32));
			let side = crate::gamepad::side(&key);
			self.emit(key, down, side);
			return;
		}
		let touchpad = self.devices[index].touchpad && (self.callbacks.touchpad_input)();
		if self.devices[index].touchpad && code == BTN_TOUCH {
			if touchpad {
				self.emit("Touchpad".into(), down, "left");
			}
			return;
		}
		if let Some(mouse) = mouse_name(code) {
			let key = if touchpad && mouse == "MouseLeft" { "Touchpad" } else { mouse };
			self.emit(key.into(), down, crate::keys::mouse_side(mouse));
		} else if code < 256 {
			let key = key_name(code);
			let side = crate::keys::keyboard_side(&key);
			self.emit(key, down, side);
		}
	}

	fn handle_axis(&mut self, index: usize, gamepad: &str, code: u16, value: i32) {
		let Some(axis) = axis_name(code) else { return };
		let threshold = if axis.starts_with("DPad") { 0 } else { 64 };
		let direction = if value > threshold {
			"Positive"
		} else if value < -threshold {
			"Negative"
		} else {
			""
		};
		let previous = self.devices[index].axes.get(&code).copied().unwrap_or("");
		if previous == direction {
			return;
		}
		if !previous.is_empty() {
			let key = format!("{gamepad}:{axis}{previous}");
			let side = crate::gamepad::side(&key);
			self.emit(key, false, side);
		}
		if !direction.is_empty() {
			let key = format!("{gamepad}:{axis}{direction}");
			let side = crate::gamepad::side(&key);
			self.emit(key, true, side);
		}
		self.devices[index].axes.insert(code, direction);
	}
}

/// Starts the reader thread. Devices are rescanned every second, so controllers plugged in later and
/// permissions granted while running are picked up without a restart.
pub fn start(status: Arc<crate::InputDevices>, callbacks: Callbacks) {
	let mut reader = Reader { devices: Vec::new(), next_gamepad: 0, callbacks, status, held: HashSet::new() };
	std::thread::spawn(move || {
		let mut last_scan: Option<Instant> = None;
		loop {
			if last_scan.is_none_or(|time| time.elapsed() >= RESCAN) {
				reader.rescan();
				last_scan = Some(Instant::now());
			}
			reader.poll();
			std::thread::sleep(POLL);
		}
	});
}
