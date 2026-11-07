import fs from "node:fs"
import path from "node:path"
import type { BrowserWindow } from "electron"
import type { CatalogItem, CollectionState } from "./types.js"
import * as core from "./core.js"

interface InputManagerOptions {
	state: CollectionState
	items: CatalogItem[]
	getPet: () => BrowserWindow | null
	dataDir: string
	qa: boolean
	save: () => Promise<boolean>
	laterSave: () => void
	onStatus: () => void
}

export function createInputManager(options: InputManagerOptions) {
	const { state, items, getPet, dataDir, qa, save, laterSave, onStatus } = options
	const pressed = new Set<string>()
	let inputSerial = 0
	let hook: any
	let hookActive = false
	let evdevDevices: any[] = []
	let evdevTimer: NodeJS.Timeout | null = null
	let evdevScanTimer: NodeJS.Timeout | null = null
	let nextGamepadNumber = 0
	let hookStatus = "Connecting keyboard..."

	function input(
		key: string,
		down: boolean,
		side: "left" | "right" = "right",
		newPhysicalPress = false,
		countTap = true,
	) {
		if (!state.settings.inputEnabled) return
		if (down && pressed.has(key) && !newPhysicalPress) return
		if (down) {
			pressed.add(key)
			const triggerGroup = gamepadTriggerGroup(key)
			const triggerAlreadyPressed =
				triggerGroup !== null &&
				[...pressed].some(activeKey => activeKey !== key && gamepadTriggerGroup(activeKey) === triggerGroup)
			if (countTap && !triggerAlreadyPressed) {
				const emote = core.registerTap(state, items)
				if (state.count === 0) {
					save()
					if (emote) getPet()?.webContents.send("emote", emote)
				} else laterSave()
			}
		} else pressed.delete(key)
		const event = {
			key,
			down,
			side,
			count: state.count,
			serial: ++inputSerial,
		}
		getPet()?.webContents.send("input", event)
	}

	const LINUX_KEYMAP = {
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
	const LINUX_MOUSEMAP = {
		272: "MouseLeft",
		273: "MouseRight",
		274: "MouseMiddle",
		275: "MouseBack",
		276: "MouseForward",
		277: "MouseForward",
		278: "MouseBack",
	}
	const UIOHOOK_MOUSEMAP: Record<number, string> = {
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

	const LINUX_GAMEPAD_AXES: Record<number, string> = {
		0: "LeftStickX",
		1: "LeftStickY",
		2: "LeftTriggerAxis",
		3: "RightStickX",
		4: "RightStickY",
		5: "RightTriggerAxis",
		16: "DPadX",
		17: "DPadY",
	}

	function gamepadButtonName(device, code: number) {
		return `${device.name}:${LINUX_GAMEPAD_BUTTONS[code] || `Button${code}`}`
	}

	function gamepadSide(key: string): "left" | "right" {
		return /:(DPad|LeftStick|LeftTriggerAxis|L1$|L2$|L3$)/.test(key) ? "left" : "right"
	}

	function releaseGamepadInputs(device) {
		for (const key of [...pressed]) {
			if (key.startsWith(`${device.name}:`)) input(key, false, gamepadSide(key))
		}
	}

	function gamepadTriggerGroup(key: string): string | null {
		const match = key.match(/^(Gamepad\d+):(L2|LeftTriggerAxisPositive|R2|RightTriggerAxisPositive)$/)
		if (!match) return null
		return `${match[1]}:${match[2] === "L2" || match[2].startsWith("Left") ? "LT" : "RT"}`
	}

	function readGamepadAxis(device, code: number, value: number) {
		const axis = LINUX_GAMEPAD_AXES[code]
		if (!axis) return
		if (axis.includes("Stick")) return

		const name = `${device.name}:${axis}`
		const threshold = axis.startsWith("DPad") ? 0 : axis.endsWith("TriggerAxis") ? 64 : 8192
		const direction = value > threshold ? "Positive" : value < -threshold ? "Negative" : ""
		const previous = device.axes.get(code) || ""

		if (previous === direction) return
		if (previous) input(`${name}${previous}`, false, gamepadSide(`${name}${previous}`))
		if (direction) input(`${name}${direction}`, true, gamepadSide(`${name}${direction}`), true, true)
		device.axes.set(code, direction)
	}

	function readEvdev(device, chunk) {
		const buf = Buffer.concat([device.leftover, chunk]),
			eventSize = 24
		let offset = 0
		while (offset + eventSize <= buf.length) {
			const type = buf.readUInt16LE(offset + 16),
				code = buf.readUInt16LE(offset + 18),
				value = buf.readInt32LE(offset + 20)
			offset += eventSize
			if (type === 0 && code === 3) {
				pressed.clear()
				continue
			}
			if (device.isGamepad && type === 3) {
				readGamepadAxis(device, code, value)
				continue
			}
			if (type !== 1) continue
			if (device.isGamepad) {
				if (value === 0 || value === 1)
					input(gamepadButtonName(device, code), value === 1, gamepadSide(gamepadButtonName(device, code)), value === 1)
				continue
			}
			const receiveTouchpadInput = device.isTouchpad && state.settings.touchpadInput
			if (device.isTouchpad && code === 330 && (value === 0 || value === 1)) {
				if (receiveTouchpadInput) input("Touchpad", value === 1, "left", value === 1)
				continue
			}
			const mouse = LINUX_MOUSEMAP[code]
			const key = LINUX_KEYMAP[code] || "Key" + code
			if (mouse && (value === 1 || value === 0))
				input(
					receiveTouchpadInput && mouse === "MouseLeft" ? "Touchpad" : mouse,
					value === 1,
					mouse === "MouseLeft" ? "left" : "right",
				)
			else if (code < 256 && (value === 0 || value === 1)) {
				const down = value === 1
				input(
					key,
					down,
					/^[QWERTASDFGZXCVB12345]$|Left|^Ctrl$|^Shift$|^Alt$|Tab|CapsLock/.test(key) ? "left" : "right",
					down,
				)
				if (
					down &&
					(pressed.has("Ctrl") || pressed.has("Meta")) &&
					pressed.has("Alt") &&
					["1", "2", "3", "4", "5"].includes(key)
				) {
					const id = state.emotes[Number(key) - 1]
					if (id) getPet()?.webContents.send("emote", id)
				}
			}
		}
		device.leftover = buf.subarray(offset)
	}
	function scanEvdevDevices() {
		if (process.platform !== "linux") return

		let deviceEntries: string[]
		try {
			deviceEntries = fs.readFileSync("/proc/bus/input/devices", "utf8").split("\n\n")
		} catch {
			return
		}

		const candidates = new Map<string, { handlers: string; isGamepad: boolean; isTouchpad: boolean }>()
		for (const block of deviceEntries) {
			const handlers = block.match(/Handlers=(.*)/)?.[1] || ""
			const deviceName = block.match(/Name="([^"]+)"/)?.[1] || ""
			const isGamepad =
				/\bjs\d+\b/.test(handlers) ||
				/gamepad|joystick|controller|xbox|x-box|dualsense|dualshock|joy-?con/i.test(deviceName)
			const isTouchpad = /touchpad|trackpad|synaptics|elan|alps|glidepoint/i.test(deviceName)
			if (!isGamepad && !isTouchpad && !/\b(?:kbd|mouse\d*)\b/.test(handlers)) continue
			const eventNumber = block.match(/\bevent(\d+)\b/)?.[1]
			if (eventNumber)
				candidates.set(`/dev/input/event${eventNumber}`, {
					handlers,
					isGamepad,
					isTouchpad,
				})
		}

		const previousCount = evdevDevices.length
		for (const device of [...evdevDevices]) {
			if (candidates.has(device.path)) continue
			evdevDevices = evdevDevices.filter(entry => entry !== device)
			if (device.isGamepad) releaseGamepadInputs(device)
			try {
				fs.closeSync(device.fd)
			} catch {}
			if (device.isKeyboard) pressed.clear()
		}

		for (const [devPath, candidate] of candidates) {
			if (evdevDevices.some(device => device.path === devPath)) continue
			try {
				fs.accessSync(devPath, fs.constants.R_OK)
				const fd = fs.openSync(devPath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK)
				evdevDevices.push({
					fd,
					path: devPath,
					isKeyboard: /\bkbd\b/.test(candidate.handlers),
					isGamepad: candidate.isGamepad,
					isTouchpad: candidate.isTouchpad,
					name: candidate.isGamepad ? `Gamepad${++nextGamepadNumber}` : "",
					axes: new Map<number, string>(),
					buffer: Buffer.alloc(4096),
					leftover: Buffer.alloc(0),
				})
			} catch {}
		}

		if (evdevDevices.length && !evdevTimer) {
			evdevTimer = setInterval(() => {
				for (const device of [...evdevDevices]) {
					try {
						for (;;) {
							const size = fs.readSync(device.fd, device.buffer, 0, device.buffer.length, null)
							if (!size) break
							readEvdev(device, device.buffer.subarray(0, size))
						}
					} catch (error) {
						const code = (error as NodeJS.ErrnoException).code
						if (code === "EAGAIN" || code === "EWOULDBLOCK") continue
						evdevDevices = evdevDevices.filter(entry => entry !== device)
						if (device.isGamepad) releaseGamepadInputs(device)
						try {
							fs.closeSync(device.fd)
						} catch {}
						if (device.isKeyboard) pressed.clear()
					}
				}
				if (!evdevDevices.length && evdevTimer) {
					clearInterval(evdevTimer)
					evdevTimer = null
				}
			}, 8)
		}

		if (evdevDevices.length !== previousCount && !hookStatus.startsWith("Connecting")) {
			hookStatus = evdevDevices.length
				? "Global input connected (evdev)"
				: hookActive
					? "Global input connected (uiohook)"
					: "Wayland: Input permission required (run ./fix-permissions.sh)"
			onStatus()
		}
	}

	function startEvdev() {
		if (process.platform !== "linux") return false
		if (evdevTimer) clearInterval(evdevTimer)
		if (evdevScanTimer) clearInterval(evdevScanTimer)
		evdevTimer = null
		evdevScanTimer = null
		pressed.clear()
		for (const device of evdevDevices) {
			try {
				fs.closeSync(device.fd)
			} catch {}
		}
		evdevDevices = []

		scanEvdevDevices()
		evdevScanTimer = setInterval(scanEvdevDevices, 1000)
		return evdevDevices.length > 0
	}

	function attachWindowInput(w) {
		if (!w || w.isDestroyed()) return
		w.webContents.on("before-input-event", (_event, ev) => {
			if (hookActive || evdevDevices.some(device => device.isKeyboard)) return
			if (ev.type === "keyDown" || ev.type === "keyUp") {
				const down = ev.type === "keyDown"
				let k = ev.key.length === 1 ? ev.key.toUpperCase() : ev.key
				if (k === " ") k = "Space"
				else if (k === "Control") k = "Ctrl"
				else if (k === "Shift") k = "Shift"
				else if (k === "Alt") k = "Alt"
				else if (k === "CapsLock") k = "CapsLock"
				else if (k === "Backspace") k = "Backspace"
				else if (k === "Enter") k = "Enter"
				else if (k === "Tab") k = "Tab"
				else if (k === "Meta") k = "Meta"
				else if (k === ";") k = "Semicolon"
				else if (k === ",") k = "Comma"
				else if (k === ".") k = "Period"
				else if (k === "/") k = "Slash"
				input(k, down, /^[QWERTASDFGZXCVB12345]$|Left|^Ctrl$|^Shift$|^Alt$|Tab|CapsLock/.test(k) ? "left" : "right")
				if (down && (ev.control || ev.meta) && ev.alt && ["1", "2", "3", "4", "5"].includes(k)) {
					const id = state.emotes[Number(k) - 1]
					if (id) getPet()?.webContents.send("emote", id)
				}
			}
		})
	}

	function startHook() {
		const evdevOk = startEvdev()
		let uiohookOk = false
		if (!process.env.WAYLAND_DISPLAY) {
			try {
				const { uIOhook, UiohookKey } = require("uiohook-napi")
				hook = uIOhook
				const names = new Map()
				for (const [k, v] of Object.entries(UiohookKey)) if (!names.has(v)) names.set(v, k)
				hook.on("keydown", e => {
					if (qa && process.argv.includes("--selftest")) return
					const key = names.get(e.keycode) || "Other"
					input(
						key,
						true,
						/^[QWERTASDFGZXCVB12345]$|Left|^Ctrl$|^Shift$|^Alt$|Tab|CapsLock/.test(key) ? "left" : "right",
					)
					if ((e.ctrlKey || e.metaKey) && e.altKey && ["1", "2", "3", "4", "5"].includes(key)) {
						const id = state.emotes[Number(key) - 1]
						if (id) getPet()?.webContents.send("emote", id)
					}
				})
				hook.on("keyup", e => {
					if (qa && process.argv.includes("--selftest")) return
					input(names.get(e.keycode) || "Other", false)
				})
				hook.on("mousedown", e => {
					if (qa && process.argv.includes("--selftest")) return
					const key = UIOHOOK_MOUSEMAP[Number(e.button)]
					if (key) input(key, true, key === "MouseLeft" ? "left" : "right")
				})
				hook.on("mouseup", e => {
					if (qa && process.argv.includes("--selftest")) return
					const key = UIOHOOK_MOUSEMAP[Number(e.button)]
					if (key) input(key, false)
				})
				hook.start()
				hookActive = true
				uiohookOk = true
			} catch (e) {
				fs.appendFileSync(path.join(dataDir, "errors.log"), String(e) + "\n")
			}
		}
		if (evdevOk) hookStatus = "Global input connected (evdev)"
		else if (uiohookOk) hookStatus = "Global input connected (uiohook)"
		else
			hookStatus =
				process.platform === "darwin"
					? "macOS: Accessibility permission required (System Settings > Privacy & Security > Accessibility)"
					: "Wayland: Input permission required (run ./fix-permissions.sh)"
		onStatus()
	}

	function clearPressed() {
		pressed.clear()
	}

	function stop() {
		if (evdevTimer) clearInterval(evdevTimer)
		if (evdevScanTimer) clearInterval(evdevScanTimer)
		evdevTimer = null
		evdevScanTimer = null
		for (const device of evdevDevices) {
			try {
				fs.closeSync(device.fd)
			} catch {}
		}
		evdevDevices = []
		try {
			hook?.stop()
		} catch {}
	}

	return {
		input,
		attachWindowInput,
		start: startHook,
		clearPressed,
		stop,
		get status() {
			return hookStatus
		},
	}
}
