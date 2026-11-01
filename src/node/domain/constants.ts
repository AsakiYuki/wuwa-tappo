import type { Rarity, Settings } from "../types.js"

const RARITIES: Rarity[] = ["common", "uncommon", "rare", "epic"]
const DEFAULTS: Settings = {
	scale: 1,
	opacity: 1,
	alwaysOnTop: true,
	passthrough: false,
	inputEnabled: true,
	autoStart: false,
	monitor: 0,
	lockDrag: false,
	hoverFade: false,
	showChest: true,
	showKeyboard: true,
	autoEmote: true,
	showPressedKeys: true,
	counterLeft: false,
	counterLimit: 999,
	bubbleLifetime: 1,
	controllerStyle: "xbox",
	keyLabels: {
		Meta: "Meta",
		Ctrl: "Ctrl",
		Alt: "Alt",
		Shift: "Shift",
		Tab: "Tab",
		CapsLock: "Caps",
		Backspace: "⌫",
		Enter: "↵",
		Space: "SPACE",
	},
	holdAnimation: false,
	handAnimation: "adaptive",
	petPosition: null,
}
export { RARITIES, DEFAULTS }
