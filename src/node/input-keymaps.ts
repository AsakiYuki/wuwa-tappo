import type { HandSide } from "./types.js"

/** Linux evdev key codes → canonical key names used across the app. */
export const LINUX_KEYMAP: Record<number, string> = {
	1: "Escape",
	2: "1",
	3: "2",
	4: "3",
	5: "4",
	6: "5",
	7: "6",
	8: "7",
	9: "8",
	10: "9",
	11: "0",
	12: "Minus",
	13: "Equal",
	14: "Backspace",
	15: "Tab",
	16: "Q",
	17: "W",
	18: "E",
	19: "R",
	20: "T",
	21: "Y",
	22: "U",
	23: "I",
	24: "O",
	25: "P",
	26: "BracketLeft",
	27: "BracketRight",
	28: "Enter",
	29: "Ctrl",
	30: "A",
	31: "S",
	32: "D",
	33: "F",
	34: "G",
	35: "H",
	36: "J",
	37: "K",
	38: "L",
	39: "Semicolon",
	40: "Quote",
	41: "Backquote",
	42: "Shift",
	43: "Backslash",
	44: "Z",
	45: "X",
	46: "C",
	47: "V",
	48: "B",
	49: "N",
	50: "M",
	51: "Comma",
	52: "Period",
	53: "Slash",
	54: "ShiftRight",
	56: "Alt",
	57: "Space",
	58: "CapsLock",
	59: "F1",
	60: "F2",
	61: "F3",
	62: "F4",
	63: "F5",
	64: "F6",
	65: "F7",
	66: "F8",
	67: "F9",
	68: "F10",
	87: "F11",
	88: "F12",
	97: "CtrlRight",
	100: "AltRight",
	102: "Home",
	103: "ArrowUp",
	104: "PageUp",
	105: "ArrowLeft",
	106: "ArrowRight",
	107: "End",
	108: "ArrowDown",
	109: "PageDown",
	110: "Insert",
	111: "Delete",
	125: "Meta",
	126: "MetaRight",
}

export const LINUX_MOUSEMAP: Record<number, string> = {
	272: "MouseLeft",
	273: "MouseRight",
	274: "MouseMiddle",
	275: "MouseBack",
	276: "MouseForward",
	277: "MouseForward",
	278: "MouseBack",
}

export const UIOHOOK_MOUSEMAP: Record<number, string> = {
	1: "MouseLeft",
	2: "MouseRight",
	3: "MouseMiddle",
	4: "MouseBack",
	5: "MouseForward",
}

const LINUX_GAMEPAD_BUTTONS: Record<number, string> = {
	288: "Trigger",
	289: "Trigger2",
	290: "Thumb",
	291: "Thumb2",
	292: "Top",
	293: "Top2",
	294: "Pinkie",
	295: "Base",
	296: "Base2",
	297: "Base3",
	298: "Base4",
	299: "Base5",
	300: "Base6",
	304: "South",
	305: "East",
	306: "C",
	307: "North",
	308: "West",
	310: "L1",
	311: "R1",
	312: "L2",
	313: "R2",
	314: "Select",
	315: "Start",
	316: "Mode",
	317: "L3",
	318: "R3",
	544: "DPadUp",
	545: "DPadDown",
	546: "DPadLeft",
	547: "DPadRight",
}

/** Gamepad axes that count as presses; analog sticks are deliberately not listed (they never tap). */
export const LINUX_GAMEPAD_AXES: Record<number, string> = {
	2: "LeftTriggerAxis",
	5: "RightTriggerAxis",
	16: "DPadX",
	17: "DPadY",
}

/** Browser `KeyboardEvent.key` values that differ from the canonical key names. */
const WINDOW_KEY_ALIASES: Record<string, string> = {
	" ": "Space",
	Control: "Ctrl",
	";": "Semicolon",
	",": "Comma",
	".": "Period",
	"/": "Slash",
}

export function windowKeyName(key: string): string {
	if (WINDOW_KEY_ALIASES[key]) return WINDOW_KEY_ALIASES[key]
	return key.length === 1 ? key.toUpperCase() : key
}

const LEFT_HAND_KEYS = /^[QWERTASDFGZXCVB12345]$|Left|^Ctrl$|^Shift$|^Alt$|Tab|CapsLock/

/** Which hand the pet uses for a keyboard key. */
export function keyboardSide(key: string): HandSide {
	return LEFT_HAND_KEYS.test(key) ? "left" : "right"
}

export function mouseSide(key: string): HandSide {
	return key === "MouseLeft" ? "left" : "right"
}

export function gamepadSide(key: string): HandSide {
	return /:(DPad|LeftTriggerAxis|L1$|L2$|L3$)/.test(key) ? "left" : "right"
}

export function gamepadButtonName(deviceName: string, code: number): string {
	return `${deviceName}:${LINUX_GAMEPAD_BUTTONS[code] || `Button${code}`}`
}

/** Analog and digital triggers of one pad report the same press; group them so only one tap counts. */
export function gamepadTriggerGroup(key: string): string | null {
	const match = key.match(/^(Gamepad\d+):(L2|LeftTriggerAxisPositive|R2|RightTriggerAxisPositive)$/)
	if (!match) return null
	return `${match[1]}:${match[2] === "L2" || match[2].startsWith("Left") ? "LT" : "RT"}`
}

const EMOTE_HOTKEYS = ["1", "2", "3", "4", "5"]

/** Returns the emote slot for Ctrl/Meta+Alt+1…5, or -1. */
export function emoteHotkeySlot(key: string, controlOrMeta: boolean, alt: boolean): number {
	if (!controlOrMeta || !alt) return -1
	return EMOTE_HOTKEYS.indexOf(key)
}
