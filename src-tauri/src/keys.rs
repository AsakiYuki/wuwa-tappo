//! Maps rdev keys to the names uiohook-napi's `UiohookKey` uses, which the renderer expects
//! (src/node/input-keymaps.ts, src/renderer/pet/lib/keys.ts).

use rdev::{Button, Key};

pub fn key_name(key: Key) -> String {
	use Key::*;
	let name = match key {
		KeyA => "A", KeyB => "B", KeyC => "C", KeyD => "D", KeyE => "E", KeyF => "F", KeyG => "G",
		KeyH => "H", KeyI => "I", KeyJ => "J", KeyK => "K", KeyL => "L", KeyM => "M", KeyN => "N",
		KeyO => "O", KeyP => "P", KeyQ => "Q", KeyR => "R", KeyS => "S", KeyT => "T", KeyU => "U",
		KeyV => "V", KeyW => "W", KeyX => "X", KeyY => "Y", KeyZ => "Z",
		Num0 => "0", Num1 => "1", Num2 => "2", Num3 => "3", Num4 => "4",
		Num5 => "5", Num6 => "6", Num7 => "7", Num8 => "8", Num9 => "9",
		F1 => "F1", F2 => "F2", F3 => "F3", F4 => "F4", F5 => "F5", F6 => "F6",
		F7 => "F7", F8 => "F8", F9 => "F9", F10 => "F10", F11 => "F11", F12 => "F12",
		Space => "Space",
		Return => "Enter",
		Tab => "Tab",
		Backspace => "Backspace",
		CapsLock => "CapsLock",
		Escape => "Escape",
		ShiftLeft => "Shift",
		ShiftRight => "ShiftRight",
		ControlLeft => "Ctrl",
		ControlRight => "CtrlRight",
		Alt => "Alt",
		AltGr => "AltRight",
		MetaLeft => "Meta",
		MetaRight => "MetaRight",
		SemiColon => "Semicolon",
		Comma => "Comma",
		Dot => "Period",
		Slash => "Slash",
		BackSlash => "Backslash",
		Quote => "Quote",
		BackQuote => "Backquote",
		LeftBracket => "BracketLeft",
		RightBracket => "BracketRight",
		Minus => "Minus",
		Equal => "Equal",
		UpArrow => "ArrowUp",
		DownArrow => "ArrowDown",
		LeftArrow => "ArrowLeft",
		RightArrow => "ArrowRight",
		Insert => "Insert",
		Delete => "Delete",
		Home => "Home",
		End => "End",
		PageUp => "PageUp",
		PageDown => "PageDown",
		PrintScreen => "PrintScreen",
		ScrollLock => "ScrollLock",
		Pause => "Pause",
		NumLock => "NumLock",
		Kp0 => "Numpad0", Kp1 => "Numpad1", Kp2 => "Numpad2", Kp3 => "Numpad3", Kp4 => "Numpad4",
		Kp5 => "Numpad5", Kp6 => "Numpad6", Kp7 => "Numpad7", Kp8 => "Numpad8", Kp9 => "Numpad9",
		KpReturn => "NumpadEnter",
		KpPlus => "NumpadAdd",
		KpMinus => "NumpadSubtract",
		KpMultiply => "NumpadMultiply",
		KpDivide => "NumpadDivide",
		KpDelete => "NumpadDecimal",
		_ => "Other",
	};
	name.to_string()
}

/// Same rule as `keyboardSide` in src/node/input-keymaps.ts.
pub fn keyboard_side(key: &str) -> &'static str {
	let single_left = key.len() == 1 && "QWERTASDFGZXCVB12345".contains(key);
	let left = single_left
		|| key.contains("Left")
		|| matches!(key, "Ctrl" | "Shift" | "Alt")
		|| key.contains("Tab")
		|| key.contains("CapsLock");
	if left { "left" } else { "right" }
}

/// Side buttons arrive as `Button::Unknown`, numbered per OS: XBUTTON1/2 on Windows, X11 buttons 8/9,
/// and macOS's "other" mouse buttons 3/4.
const SIDE_BUTTONS: (u8, u8) = if cfg!(windows) {
	(1, 2)
} else if cfg!(target_os = "macos") {
	(3, 4)
} else {
	(8, 9)
};

pub fn mouse_name(button: Button) -> Option<&'static str> {
	match button {
		Button::Left => Some("MouseLeft"),
		Button::Right => Some("MouseRight"),
		Button::Middle => Some("MouseMiddle"),
		Button::Unknown(code) if code == SIDE_BUTTONS.0 => Some("MouseBack"),
		Button::Unknown(code) if code == SIDE_BUTTONS.1 => Some("MouseForward"),
		_ => None,
	}
}

pub fn mouse_side(key: &str) -> &'static str {
	if key == "MouseLeft" { "left" } else { "right" }
}
