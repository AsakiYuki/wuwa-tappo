//! Global keyboard and mouse input on macOS through a listen-only CGEventTap.
//!
//! rdev is not used here: its macOS listener translates every key press to text with TIS /
//! UCKeyTranslate on the hook thread, which macOS 14+ only allows on the main thread (the process
//! is killed by a dispatch assertion), and it drops the middle and side mouse buttons.
//!
//! A listen-only tap needs the Input Monitoring permission (System Settings > Privacy & Security >
//! Input Monitoring). Without it `listen` returns `Err(Permission)` after asking macOS to show its
//! prompt once; the caller retries until the user has granted it.

use crate::keys;
use std::ffi::c_void;
use std::sync::atomic::{AtomicPtr, Ordering};

pub const INPUT_MONITORING_SETTINGS: &str =
	"x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent";
pub const PERMISSION_STATUS: &str =
	"macOS: Input Monitoring permission required (System Settings > Privacy & Security > Input Monitoring), then restart Wuwa Tappo";

pub enum ListenError {
	/// Input Monitoring has not been granted.
	Permission,
	/// The tap or its run loop source could not be created.
	Tap,
}

type CGEventRef = *mut c_void;
type CFMachPortRef = *mut c_void;
type TapCallback = extern "C" fn(*mut c_void, u32, CGEventRef, *mut c_void) -> CGEventRef;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
	fn CGEventTapCreate(
		tap: u32,
		place: u32,
		options: u32,
		events_of_interest: u64,
		callback: TapCallback,
		user_info: *mut c_void,
	) -> CFMachPortRef;
	fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
	fn CGEventGetIntegerValueField(event: CGEventRef, field: u32) -> i64;
	fn CGEventGetFlags(event: CGEventRef) -> u64;
	fn CGPreflightListenEventAccess() -> bool;
	fn CGRequestListenEventAccess() -> bool;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
	fn CFMachPortCreateRunLoopSource(allocator: *const c_void, port: CFMachPortRef, order: isize) -> *mut c_void;
	fn CFRunLoopGetCurrent() -> *mut c_void;
	fn CFRunLoopAddSource(run_loop: *mut c_void, source: *mut c_void, mode: *const c_void);
	fn CFRunLoopRun();
	static kCFRunLoopCommonModes: *const c_void;
}

const SESSION_EVENT_TAP: u32 = 1;
const HEAD_INSERT: u32 = 0;
const LISTEN_ONLY: u32 = 1;

const LEFT_MOUSE_DOWN: u32 = 1;
const LEFT_MOUSE_UP: u32 = 2;
const RIGHT_MOUSE_DOWN: u32 = 3;
const RIGHT_MOUSE_UP: u32 = 4;
const KEY_DOWN: u32 = 10;
const KEY_UP: u32 = 11;
const FLAGS_CHANGED: u32 = 12;
const OTHER_MOUSE_DOWN: u32 = 25;
const OTHER_MOUSE_UP: u32 = 26;
/// macOS turns a tap off when a callback is slow or on secure input; it is switched back on.
const TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFF_FFFE;
const TAP_DISABLED_BY_USER_INPUT: u32 = 0xFFFF_FFFF;

const MOUSE_BUTTON_NUMBER: u32 = 3;
const KEYBOARD_KEYCODE: u32 = 9;

const CAPS_LOCK_CODE: i64 = 57;
/// Device-dependent modifier bits (IOKit's NX_DEVICE*KEYMASK): which side is held, which the
/// device-independent flags do not tell. Fn has no name in the renderer and is skipped.
fn modifier_bit(code: i64) -> Option<u64> {
	Some(match code {
		59 => 0x0001, // left control
		56 => 0x0002, // left shift
		60 => 0x0004, // right shift
		55 => 0x0008, // left command
		54 => 0x0010, // right command
		58 => 0x0020, // left option
		61 => 0x0040, // right option
		62 => 0x2000, // right control
		_ => return None,
	})
}

/// Virtual key codes (HIToolbox kVK_*) to the same names as `keys::key_name`.
fn key_name(code: i64) -> &'static str {
	match code {
		0 => "A", 11 => "B", 8 => "C", 2 => "D", 14 => "E", 3 => "F", 5 => "G", 4 => "H", 34 => "I",
		38 => "J", 40 => "K", 37 => "L", 46 => "M", 45 => "N", 31 => "O", 35 => "P", 12 => "Q",
		15 => "R", 1 => "S", 17 => "T", 32 => "U", 9 => "V", 13 => "W", 7 => "X", 16 => "Y", 6 => "Z",
		29 => "0", 18 => "1", 19 => "2", 20 => "3", 21 => "4", 23 => "5", 22 => "6", 26 => "7",
		28 => "8", 25 => "9",
		122 => "F1", 120 => "F2", 99 => "F3", 118 => "F4", 96 => "F5", 97 => "F6", 98 => "F7",
		100 => "F8", 101 => "F9", 109 => "F10", 103 => "F11", 111 => "F12",
		105 => "F13", 107 => "F14", 113 => "F15", 106 => "F16", 64 => "F17", 79 => "F18",
		80 => "F19", 90 => "F20",
		49 => "Space",
		36 => "Enter",
		48 => "Tab",
		51 => "Backspace",
		57 => "CapsLock",
		53 => "Escape",
		56 => "Shift",
		60 => "ShiftRight",
		59 => "Ctrl",
		62 => "CtrlRight",
		58 => "Alt",
		61 => "AltRight",
		55 => "Meta",
		54 => "MetaRight",
		41 => "Semicolon",
		43 => "Comma",
		47 => "Period",
		44 => "Slash",
		42 => "Backslash",
		39 => "Quote",
		50 => "Backquote",
		33 => "BracketLeft",
		30 => "BracketRight",
		27 => "Minus",
		24 => "Equal",
		126 => "ArrowUp",
		125 => "ArrowDown",
		123 => "ArrowLeft",
		124 => "ArrowRight",
		114 => "Insert", // Help, where PC keyboards have Insert
		117 => "Delete",
		115 => "Home",
		119 => "End",
		116 => "PageUp",
		121 => "PageDown",
		71 => "NumLock", // keypad Clear sits where Num Lock is
		82 => "Numpad0", 83 => "Numpad1", 84 => "Numpad2", 85 => "Numpad3", 86 => "Numpad4",
		87 => "Numpad5", 88 => "Numpad6", 89 => "Numpad7", 91 => "Numpad8", 92 => "Numpad9",
		76 => "NumpadEnter",
		69 => "NumpadAdd",
		78 => "NumpadSubtract",
		67 => "NumpadMultiply",
		75 => "NumpadDivide",
		65 => "NumpadDecimal",
		81 => "NumpadEqual",
		_ => "Other",
	}
}

type OnInput = Box<dyn Fn(String, bool, &'static str)>;

struct Context {
	tap: AtomicPtr<c_void>,
	on_input: OnInput,
}

fn key_event(context: &Context, name: &'static str, down: bool) {
	(context.on_input)(name.to_string(), down, keys::keyboard_side(name));
}

fn mouse_event(context: &Context, button: rdev::Button, down: bool) {
	if let Some(name) = keys::mouse_name(button) {
		(context.on_input)(name.to_string(), down, keys::mouse_side(name));
	}
}

extern "C" fn callback(_proxy: *mut c_void, kind: u32, event: CGEventRef, user_info: *mut c_void) -> CGEventRef {
	// SAFETY: `user_info` is the `Context` leaked in `listen`, which lives for the whole process.
	let context = unsafe { &*(user_info as *const Context) };
	// SAFETY: macOS passes a valid event for the duration of the callback.
	let field = |name| unsafe { CGEventGetIntegerValueField(event, name) };
	match kind {
		TAP_DISABLED_BY_TIMEOUT | TAP_DISABLED_BY_USER_INPUT => {
			let tap = context.tap.load(Ordering::Acquire);
			if !tap.is_null() {
				// SAFETY: the tap is the live mach port created in `listen`.
				unsafe { CGEventTapEnable(tap, true) };
			}
		}
		KEY_DOWN | KEY_UP => key_event(context, key_name(field(KEYBOARD_KEYCODE)), kind == KEY_DOWN),
		FLAGS_CHANGED => {
			let code = field(KEYBOARD_KEYCODE);
			if code == CAPS_LOCK_CODE {
				// Caps Lock only reports a state toggle, once per press.
				key_event(context, "CapsLock", true);
				key_event(context, "CapsLock", false);
			} else if let Some(bit) = modifier_bit(code) {
				// SAFETY: as above.
				let flags = unsafe { CGEventGetFlags(event) };
				key_event(context, key_name(code), flags & bit != 0);
			}
		}
		LEFT_MOUSE_DOWN | LEFT_MOUSE_UP => mouse_event(context, rdev::Button::Left, kind == LEFT_MOUSE_DOWN),
		RIGHT_MOUSE_DOWN | RIGHT_MOUSE_UP => mouse_event(context, rdev::Button::Right, kind == RIGHT_MOUSE_DOWN),
		OTHER_MOUSE_DOWN | OTHER_MOUSE_UP => {
			let button = match field(MOUSE_BUTTON_NUMBER) {
				2 => rdev::Button::Middle,
				number => rdev::Button::Unknown(number.clamp(0, u8::MAX as i64) as u8),
			};
			mouse_event(context, button, kind == OTHER_MOUSE_DOWN);
		}
		_ => {}
	}
	event
}

/// Whether Input Monitoring is granted. Asks macOS to show its permission prompt when it is not
/// (macOS shows it only once per app; afterwards the user grants it in System Settings).
pub fn has_permission(prompt: bool) -> bool {
	// SAFETY: plain queries without arguments.
	unsafe { CGPreflightListenEventAccess() || (prompt && CGRequestListenEventAccess()) }
}

/// Runs the tap on the calling thread's run loop, calling `on_input(key, down, side)` for every key
/// and mouse button change. Only returns on failure.
pub fn listen(on_input: impl Fn(String, bool, &'static str) + 'static) -> Result<(), ListenError> {
	if !has_permission(true) {
		return Err(ListenError::Permission);
	}
	let kinds = [
		LEFT_MOUSE_DOWN,
		LEFT_MOUSE_UP,
		RIGHT_MOUSE_DOWN,
		RIGHT_MOUSE_UP,
		OTHER_MOUSE_DOWN,
		OTHER_MOUSE_UP,
		KEY_DOWN,
		KEY_UP,
		FLAGS_CHANGED,
	];
	let mask = kinds.iter().fold(0u64, |mask, kind| mask | 1 << kind);
	let context: &'static Context =
		Box::leak(Box::new(Context { tap: AtomicPtr::new(std::ptr::null_mut()), on_input: Box::new(on_input) }));
	// SAFETY: standard CGEventTap setup; `context` outlives the tap since it is never freed.
	unsafe {
		let tap = CGEventTapCreate(
			SESSION_EVENT_TAP,
			HEAD_INSERT,
			LISTEN_ONLY,
			mask,
			callback,
			context as *const Context as *mut c_void,
		);
		if tap.is_null() {
			return Err(ListenError::Tap);
		}
		context.tap.store(tap, Ordering::Release);
		let source = CFMachPortCreateRunLoopSource(std::ptr::null(), tap, 0);
		if source.is_null() {
			return Err(ListenError::Tap);
		}
		CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopCommonModes);
		CGEventTapEnable(tap, true);
		CFRunLoopRun();
	}
	Err(ListenError::Tap)
}
