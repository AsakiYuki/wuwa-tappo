import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import type { BrowserWindow } from "electron"
import type { CatalogItem, CollectionState, HandSide, InputMessage } from "./types.js"
import * as core from "./core.js"
import {
	LINUX_GAMEPAD_AXES,
	LINUX_KEYMAP,
	LINUX_MOUSEMAP,
	UIOHOOK_MOUSEMAP,
	emoteHotkeySlot,
	gamepadButtonName,
	gamepadSide,
	gamepadTriggerGroup,
	keyboardSide,
	mouseSide,
	windowKeyName,
} from "./input-keymaps.js"

interface InputManagerOptions {
	/** Read on every event: imports and resets replace the state object. */
	getState: () => CollectionState
	items: CatalogItem[]
	getPet: () => BrowserWindow | null
	dataDir: string
	qa: boolean
	save: () => Promise<boolean>
	laterSave: () => void
	onStatus: () => void
}

interface EvdevDevice {
	fd: number
	path: string
	isKeyboard: boolean
	isGamepad: boolean
	isTouchpad: boolean
	name: string
	axes: Map<number, string>
	buffer: Buffer
	leftover: Buffer
}

const EVDEV_EVENT_SIZE = 24
const EV_SYN = 0
const EV_KEY = 1
const EV_ABS = 3
const SYN_DROPPED = 3
const BTN_TOUCH = 330

const STATUS_EVDEV = "Global input connected (evdev)"
const STATUS_UIOHOOK = "Global input connected (uiohook)"
const STATUS_IOKIT = "Global input connected (IOKit Gamepad)"
const STATUS_XINPUT = "Global input connected (XInput Gamepad)"
const STATUS_WAYLAND_PERMISSION = "Wayland: Input permission required (tray menu → Fix Input Permissions)"
const STATUS_MAC_PERMISSION =
	"macOS: Accessibility permission required (System Settings > Privacy & Security > Accessibility)"
const STATUS_WINDOWS_FAILED = "Windows: Global input hook failed to start (see errors.log)"

/** Native controller watchers (src/native), one per platform without a JavaScript-readable gamepad API. */
const GAMEPAD_WATCHERS: Partial<Record<NodeJS.Platform, string>> = {
	darwin: "mac-gamepad-watcher",
	win32: "win-gamepad-watcher.exe",
}

function failureStatus() {
	if (process.platform === "darwin") return STATUS_MAC_PERMISSION
	if (process.platform === "win32") return STATUS_WINDOWS_FAILED
	return STATUS_WAYLAND_PERMISSION
}

export function createInputManager(options: InputManagerOptions) {
	const { getState, items, getPet, dataDir, qa, save, laterSave, onStatus } = options
	const pressed = new Set<string>()
	const ignoreHookInput = qa && process.argv.includes("--selftest")
	let inputSerial = 0
	let hook: { stop(): void } | undefined
	let hookActive = false
	let evdevDevices: EvdevDevice[] = []
	let evdevTimer: NodeJS.Timeout | null = null
	let evdevScanTimer: NodeJS.Timeout | null = null
	let nextGamepadNumber = 0
	let gamepadWatcher: ChildProcess | null = null
	let hookStatus = "Connecting keyboard..."

	const logError = (message: string) => fs.appendFileSync(path.join(dataDir, "errors.log"), message + "\n")
	const sendToPet = (channel: string, payload: unknown) => getPet()?.webContents.send(channel, payload)

	function input(key: string, down: boolean, side: HandSide = "right", newPhysicalPress = false, countTap = true) {
		const state = getState()
		if (!state.settings.inputEnabled) return
		if (down && pressed.has(key) && !newPhysicalPress) return
		let countedTap = false
		if (down) {
			pressed.add(key)
			const triggerGroup = gamepadTriggerGroup(key)
			const triggerAlreadyPressed =
				triggerGroup !== null &&
				[...pressed].some(activeKey => activeKey !== key && gamepadTriggerGroup(activeKey) === triggerGroup)
			if (countTap && !triggerAlreadyPressed) {
				countedTap = true
				const emote = core.registerTap(state, items)
				if (state.count === 0) {
					void save()
					if (emote) sendToPet("emote", emote)
				} else laterSave()
			}
		} else pressed.delete(key)
		const message: InputMessage = {
			key,
			down,
			side,
			count: state.count,
			totalCount: state.totalCount,
			dailyCount: state.dailyCount,
			countedTap,
			serial: ++inputSerial,
		}
		sendToPet("input", message)
	}

	/** Feeds a keyboard key and fires the Ctrl/Meta+Alt+N emote shortcut. */
	function keyboardInput(key: string, down: boolean, controlOrMeta: boolean, alt: boolean, newPhysicalPress = false) {
		input(key, down, keyboardSide(key), newPhysicalPress)
		if (!down) return
		const slot = emoteHotkeySlot(key, controlOrMeta, alt)
		const id = slot >= 0 ? getState().emotes[slot] : undefined
		if (id) sendToPet("emote", id)
	}

	/* ----------------------------- evdev ------------------------------ */

	function releaseGamepadInputs(device: EvdevDevice) {
		for (const key of [...pressed]) {
			if (key.startsWith(`${device.name}:`)) input(key, false, gamepadSide(key))
		}
	}

	function readGamepadAxis(device: EvdevDevice, code: number, value: number) {
		const axis = LINUX_GAMEPAD_AXES[code]
		if (!axis) return

		const name = `${device.name}:${axis}`
		const threshold = axis.startsWith("DPad") ? 0 : axis.endsWith("TriggerAxis") ? 64 : 8192
		const direction = value > threshold ? "Positive" : value < -threshold ? "Negative" : ""
		const previous = device.axes.get(code) || ""

		if (previous === direction) return
		if (previous) input(`${name}${previous}`, false, gamepadSide(`${name}${previous}`))
		if (direction) input(`${name}${direction}`, true, gamepadSide(`${name}${direction}`), true, true)
		device.axes.set(code, direction)
	}

	function readEvdev(device: EvdevDevice, chunk: Buffer) {
		// Self-tests drive input themselves; real key presses during a run would skew their counters.
		if (ignoreHookInput) return
		const buffer = Buffer.concat([device.leftover, chunk])
		let offset = 0
		while (offset + EVDEV_EVENT_SIZE <= buffer.length) {
			const type = buffer.readUInt16LE(offset + 16)
			const code = buffer.readUInt16LE(offset + 18)
			const value = buffer.readInt32LE(offset + 20)
			offset += EVDEV_EVENT_SIZE
			if (type === EV_SYN && code === SYN_DROPPED) {
				pressed.clear()
				continue
			}
			if (device.isGamepad && type === EV_ABS) {
				readGamepadAxis(device, code, value)
				continue
			}
			if (type !== EV_KEY || (value !== 0 && value !== 1)) continue
			const down = value === 1
			if (device.isGamepad) {
				const button = gamepadButtonName(device.name, code)
				input(button, down, gamepadSide(button), down)
				continue
			}
			const receiveTouchpadInput = device.isTouchpad && getState().settings.touchpadInput
			if (device.isTouchpad && code === BTN_TOUCH) {
				if (receiveTouchpadInput) input("Touchpad", down, "left", down)
				continue
			}
			const mouse = LINUX_MOUSEMAP[code]
			if (mouse) {
				input(receiveTouchpadInput && mouse === "MouseLeft" ? "Touchpad" : mouse, down, mouseSide(mouse))
			} else if (code < 256) {
				const key = LINUX_KEYMAP[code] || "Key" + code
				keyboardInput(key, down, pressed.has("Ctrl") || pressed.has("Meta"), pressed.has("Alt"), down)
			}
		}
		device.leftover = buffer.subarray(offset)
	}

	function closeDevice(device: EvdevDevice) {
		evdevDevices = evdevDevices.filter(entry => entry !== device)
		if (device.isGamepad) releaseGamepadInputs(device)
		try {
			fs.closeSync(device.fd)
		} catch {}
		if (device.isKeyboard) pressed.clear()
	}

	function pollEvdevDevices() {
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
				closeDevice(device)
			}
		}
		if (!evdevDevices.length && evdevTimer) {
			clearInterval(evdevTimer)
			evdevTimer = null
		}
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
			if (eventNumber) candidates.set(`/dev/input/event${eventNumber}`, { handlers, isGamepad, isTouchpad })
		}

		const previousCount = evdevDevices.length
		for (const device of [...evdevDevices]) {
			if (!candidates.has(device.path)) closeDevice(device)
		}

		for (const [devicePath, candidate] of candidates) {
			if (evdevDevices.some(device => device.path === devicePath)) continue
			try {
				fs.accessSync(devicePath, fs.constants.R_OK)
				const fd = fs.openSync(devicePath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK)
				evdevDevices.push({
					fd,
					path: devicePath,
					isKeyboard: /\bkbd\b/.test(candidate.handlers),
					isGamepad: candidate.isGamepad,
					isTouchpad: candidate.isTouchpad,
					name: candidate.isGamepad ? `Gamepad${++nextGamepadNumber}` : "",
					axes: new Map(),
					buffer: Buffer.alloc(4096),
					leftover: Buffer.alloc(0),
				})
			} catch {}
		}

		if (evdevDevices.length && !evdevTimer) evdevTimer = setInterval(pollEvdevDevices, 8)

		if (evdevDevices.length !== previousCount && !hookStatus.startsWith("Connecting")) {
			hookStatus = evdevDevices.length ? STATUS_EVDEV : hookActive ? STATUS_UIOHOOK : STATUS_WAYLAND_PERMISSION
			onStatus()
		}
	}

	function stopEvdev() {
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
	}

	function startEvdev() {
		if (process.platform !== "linux") return false
		stopEvdev()
		pressed.clear()
		scanEvdevDevices()
		evdevScanTimer = setInterval(scanEvdevDevices, 1000)
		return evdevDevices.length > 0
	}

	/* ----------------------- macOS / Windows gamepad ----------------------- */

	function findGamepadWatcher(binary: string) {
		const appRoot = path.resolve(__dirname, "..")
		const candidates: string[] = []
		if (process.resourcesPath) {
			candidates.push(path.join(process.resourcesPath, "app.asar.unpacked", "assets", "bin", binary))
		}
		const unpackedRoot = appRoot.includes("app.asar") ? appRoot.replace("app.asar", "app.asar.unpacked") : appRoot
		candidates.push(path.join(unpackedRoot, "assets", "bin", binary))
		return candidates.find(candidate => fs.existsSync(candidate))
	}

	/** Watcher lines are `GamepadN \t evdev-code \t 0|1` (or `name \t 0|1`); `STATUS:` lines are informational. */
	function handleGamepadLine(line: string) {
		const trimmed = line.trim()
		if (ignoreHookInput || !trimmed || trimmed.startsWith("STATUS:")) return
		const parts = trimmed.split("\t")
		if (parts.length >= 3) {
			const button = gamepadButtonName(parts[0], Number(parts[1]))
			const down = parts[2] === "1"
			input(button, down, gamepadSide(button), down)
		} else if (parts.length === 2) {
			const down = parts[1] === "1"
			input(parts[0], down, gamepadSide(parts[0]), down)
		}
	}

	function startGamepadWatcher() {
		const binary = GAMEPAD_WATCHERS[process.platform]
		if (!binary) return false
		if (gamepadWatcher) return true

		const watcherPath = findGamepadWatcher(binary)
		if (!watcherPath) return false

		try {
			if (process.platform !== "win32") {
				try {
					fs.chmodSync(watcherPath, 0o755)
				} catch {}
			}
			// The Windows watcher exits on its own once this process is gone, even after a crash.
			const args = process.platform === "win32" ? [String(process.pid)] : []
			const watcher = spawn(watcherPath, args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true })
			gamepadWatcher = watcher

			let leftover = ""
			watcher.stdout?.on("data", (chunk: Buffer) => {
				const lines = (leftover + chunk.toString("utf8")).split("\n")
				leftover = lines.pop() || ""
				lines.forEach(handleGamepadLine)
			})
			const forget = () => {
				if (gamepadWatcher === watcher) gamepadWatcher = null
			}
			watcher.on("error", error => {
				logError(`gamepad-watcher: ${String(error)}`)
				forget()
			})
			watcher.on("exit", forget)
			return true
		} catch (error) {
			logError(`gamepad-watcher: ${String(error)}`)
			return false
		}
	}

	/* ---------------------------- uiohook ----------------------------- */

	function startUiohook() {
		if (process.env.WAYLAND_DISPLAY) return false
		try {
			const { uIOhook, UiohookKey } = require("uiohook-napi")
			const names = new Map<number, string>()
			for (const [name, code] of Object.entries(UiohookKey) as Array<[string, number]>)
				if (!names.has(code)) names.set(code, name)
			const keyName = (keycode: number) => names.get(keycode) || "Other"

			uIOhook.on("keydown", event => {
				if (!ignoreHookInput)
					keyboardInput(keyName(event.keycode), true, event.ctrlKey || event.metaKey, event.altKey)
			})
			uIOhook.on("keyup", event => {
				if (!ignoreHookInput) input(keyName(event.keycode), false)
			})
			uIOhook.on("mousedown", event => {
				const key = UIOHOOK_MOUSEMAP[Number(event.button)]
				if (!ignoreHookInput && key) input(key, true, mouseSide(key))
			})
			uIOhook.on("mouseup", event => {
				const key = UIOHOOK_MOUSEMAP[Number(event.button)]
				if (!ignoreHookInput && key) input(key, false)
			})
			uIOhook.start()
			hook = uIOhook
			hookActive = true
			return true
		} catch (error) {
			logError(String(error))
			return false
		}
	}

	/* ------------------------- window fallback ------------------------- */

	/** Uses in-window key events when no global hook can see the keyboard. */
	function attachWindowInput(window: BrowserWindow) {
		if (!window || window.isDestroyed()) return
		window.webContents.on("before-input-event", (_event, event) => {
			if (hookActive || evdevDevices.some(device => device.isKeyboard)) return
			if (event.type !== "keyDown" && event.type !== "keyUp") return
			keyboardInput(windowKeyName(event.key), event.type === "keyDown", event.control || event.meta, event.alt)
		})
	}

	function start() {
		const evdevOk = startEvdev()
		const gamepadOk = startGamepadWatcher()
		const uiohookOk = startUiohook()
		if (evdevOk) hookStatus = STATUS_EVDEV
		else if (uiohookOk) hookStatus = STATUS_UIOHOOK
		else if (gamepadOk) hookStatus = process.platform === "win32" ? STATUS_XINPUT : STATUS_IOKIT
		else hookStatus = failureStatus()
		onStatus()
	}

	function stop() {
		stopEvdev()
		try {
			hook?.stop()
		} catch {}
		if (gamepadWatcher) {
			try {
				gamepadWatcher.kill()
			} catch {}
			gamepadWatcher = null
		}
	}

	return {
		input,
		attachWindowInput,
		start,
		clearPressed: () => pressed.clear(),
		stop,
		get connected() {
			return hookStatus.includes("connected")
		},
		get status() {
			return hookStatus
		},
	}
}
