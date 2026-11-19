const CODE_ALIASES: Record<string, string> = {
	ControlLeft: "Ctrl",
	ControlRight: "CtrlRight",
	ShiftLeft: "Shift",
	ShiftRight: "ShiftRight",
	AltLeft: "Alt",
	AltRight: "AltRight",
	MetaLeft: "Meta",
	MetaRight: "MetaRight",
	NumpadEnter: "Enter",
}

/** Converts a browser key event into the key name used by the input hooks. */
export function capturedKeyName(event: KeyboardEvent): string {
	const { code, key } = event
	if (CODE_ALIASES[code]) return CODE_ALIASES[code]
	if (code.startsWith("Key")) return code.slice(3)
	if (code.startsWith("Digit")) return code.slice(5)
	if (code) return code
	if (key === " ") return "Space"
	return key.length === 1 ? key.toUpperCase() : key
}
