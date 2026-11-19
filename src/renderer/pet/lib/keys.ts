import { isMac } from "../../shared/assets"
import type { Settings } from "../../shared/types"

export interface KeyCap {
	key: string
	label: string
	size: "normal" | "wide" | "space"
}

const WIDE_KEYS = new Set(["Shift", "ShiftRight", "Enter", "Backspace", "CapsLock", "Tab"])

const toKeyCap = (entry: string): KeyCap => {
	const [key, label = key] = entry.split("|")
	return { key, label, size: key === "Space" ? "space" : WIDE_KEYS.has(key) ? "wide" : "normal" }
}

/** The pet's 42-key keyboard, as `Key|Label` entries. */
export const KEYBOARD_ROWS: KeyCap[][] = [
	["Tab|Tab", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "Backspace|⌫"],
	["CapsLock|Caps", "A", "S", "D", "F", "G", "H", "J", "K", "L", "Semicolon|;", "Enter|↵"],
	["Shift|Shift", "Z", "X", "C", "V", "B", "N", "M", "Comma|,", "Period|.", "Slash|/"],
	isMac
		? [
				"Ctrl|Control",
				"Alt|Option",
				"Meta|Command",
				"Space|SPACE",
				"MetaRight|Command",
				"AltRight|Option",
				"CtrlRight|Control",
			]
		: ["Ctrl|Ctrl", "Meta|Meta", "Alt|Alt", "Space|SPACE", "AltRight|Alt", "ShiftRight|Shift", "CtrlRight|Ctrl"],
].map(row => row.map(toKeyCap))

/** Right-hand modifiers light up when the generic (left) modifier is reported. */
const MODIFIER_ALIASES: Record<string, string> = { MetaRight: "Meta", AltRight: "Alt", CtrlRight: "Ctrl" }

export function isKeyActive(key: string, activeKeys: ReadonlySet<string>): boolean {
	return activeKeys.has(key) || (key in MODIFIER_ALIASES && activeKeys.has(MODIFIER_ALIASES[key]))
}

const MAC_KEY_LABELS: Record<string, string> = {
	Ctrl: "Control",
	CtrlLeft: "Control",
	CtrlRight: "Control",
	ControlLeft: "Control",
	ControlRight: "Control",
	Alt: "Option",
	AltLeft: "Option",
	AltRight: "Option",
	Meta: "Command",
	MetaLeft: "Command",
	MetaRight: "Command",
	Command: "Command",
}

const MOUSE_LABELS: Record<string, string> = {
	MouseLeft: "LMB",
	MouseRight: "RMB",
	MouseMiddle: "MMB",
	MouseBack: "BACK",
	MouseForward: "FORWARD",
	Touchpad: "TOUCH",
}

const CONTROLLER_LABELS: Record<Settings["controllerStyle"], Record<string, string>> = {
	xbox: {
		South: "A",
		East: "B",
		West: "X",
		North: "Y",
		L1: "LB",
		R1: "RB",
		L2: "LT",
		R2: "RT",
		LeftTriggerAxisPositive: "LT",
		LeftTriggerAxisNegative: "LT",
		RightTriggerAxisPositive: "RT",
		RightTriggerAxisNegative: "RT",
		L3: "LS",
		R3: "RS",
		Select: "BACK",
		Start: "START",
		Mode: "GUIDE",
	},
	ps: {
		South: "×",
		East: "○",
		West: "□",
		North: "△",
		L1: "L1",
		R1: "R1",
		L2: "L2",
		R2: "R2",
		LeftTriggerAxisPositive: "L2",
		LeftTriggerAxisNegative: "L2",
		RightTriggerAxisPositive: "R2",
		RightTriggerAxisNegative: "R2",
		L3: "L3",
		R3: "R3",
		Select: "SHARE",
		Start: "OPTIONS",
		Mode: "PS",
	},
}

const CONTROLLER_DIRECTIONS: Record<string, string> = {
	DPadUp: "Up",
	DPadDown: "Down",
	DPadLeft: "Left",
	DPadRight: "Right",
	DPadXPositive: "Right",
	DPadXNegative: "Left",
	DPadYPositive: "Down",
	DPadYNegative: "Up",
}

/** Text shown in a key bubble. Gamepad keys arrive as `GamepadN:Button`. */
export function keyLabel(rawKey: string, settings: Pick<Settings, "keyLabels" | "controllerStyle">): string {
	const key = rawKey.trim()
	if (!key) return rawKey
	const custom = settings.keyLabels
	if (custom[key] ?? MOUSE_LABELS[key]) return custom[key] ?? MOUSE_LABELS[key]
	if (isMac && MAC_KEY_LABELS[key]) return MAC_KEY_LABELS[key]
	const separator = key.lastIndexOf(":")
	if (separator < 0) return key
	const button = key.slice(separator + 1)
	const numbered = /^Button(\d+)$/.exec(button)?.[1]
	return (
		custom[button] ??
		CONTROLLER_LABELS[settings.controllerStyle][button] ??
		CONTROLLER_DIRECTIONS[button] ??
		(numbered ? `B${numbered}` : button)
	)
}
