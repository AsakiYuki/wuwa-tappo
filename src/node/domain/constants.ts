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
	counterLeft: false,
	counterLimit: 999,
	handAnimation: "adaptive",
	petPosition: null,
}
export { RARITIES, DEFAULTS }
