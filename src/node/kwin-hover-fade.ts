import { execFile, execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { PET_WINDOW_TITLE } from "./linux-window.js"
import type { HoverArea } from "./types.js"

/*
 * Hover-fade while mouse passthrough is on, for KDE Plasma on Wayland.
 *
 * The pet runs through XWayland, and XWayland only learns the pointer position while the pointer is
 * over an X11 window. With passthrough the pointer is always over whatever is *below* the pet, so
 * Electron's cursor position goes stale. KWin always knows the real position, so a small KWin script
 * does the hit test and sets the pet window's opacity itself.
 */

const SCRIPT_NAME = "wuwa-tappo-hover-fade"
const RESET_SCRIPT_NAME = "wuwa-tappo-hover-reset"
const FADED_OPACITY = 0.4
/** Matches `transition: opacity 180ms ease` on #petContent in pet.scss. */
const FADE_DURATION_MS = 180
const FRAME_MS = 16
const QDBUS_TIMEOUT_MS = 2000

const findPetWindow = `
function findPet() {
	for (const window of workspace.windowList()) if (window.caption === ${JSON.stringify(PET_WINDOW_TITLE)}) return window
	return null
}`

export function hoverScript(area: HoverArea) {
	return `${findPetWindow}
const area = ${JSON.stringify(area)}
let pet = findPet()

// Opacity eases towards the target like the page's CSS transition, restarting from wherever it is.
const animation = { from: 1, to: 1, startedAt: 0 }
const timer = new QTimer()
timer.interval = ${FRAME_MS}
timer.timeout.connect(() => {
	if (!pet) return timer.stop()
	const progress = Math.min(1, (Date.now() - animation.startedAt) / ${FADE_DURATION_MS})
	const eased = progress * progress * (3 - 2 * progress)
	pet.opacity = animation.from + (animation.to - animation.from) * eased
	if (progress === 1) timer.stop()
})

function fadeTo(opacity) {
	if (animation.to === opacity && (timer.active || pet.opacity === opacity)) return
	animation.from = pet.opacity
	animation.to = opacity
	animation.startedAt = Date.now()
	timer.start()
}

function update() {
	if (!pet) pet = findPet()
	if (!pet) return
	const frame = pet.frameGeometry
	const cursor = workspace.cursorPos
	const x = (cursor.x - frame.x) / frame.width
	const y = (cursor.y - frame.y) / frame.height
	const hovered = x >= area.left && x < area.right && y >= area.top && y < area.bottom
	fadeTo(hovered ? ${FADED_OPACITY} : 1)
}

workspace.cursorPosChanged.connect(update)
workspace.windowAdded.connect(() => { if (!pet) update() })
workspace.windowRemoved.connect(window => {
	if (window !== pet) return
	pet = null
	timer.stop()
})
update()
`
}

const resetScript = `${findPetWindow}
const pet = findPet()
if (pet) pet.opacity = 1
`

function qdbusArgs(method: string, ...args: string[]) {
	return ["org.kde.KWin", "/Scripting", `org.kde.kwin.Scripting.${method}`, ...args]
}

/** True on a KDE Plasma Wayland session where KWin's scripting interface answers. */
function kwinScriptingAvailable() {
	if (process.platform !== "linux" || process.env.XDG_SESSION_TYPE !== "wayland") return false
	if (!/KDE/i.test(process.env.XDG_CURRENT_DESKTOP ?? "")) return false
	try {
		execFileSync("qdbus", qdbusArgs("isScriptLoaded", SCRIPT_NAME), { timeout: QDBUS_TIMEOUT_MS, stdio: "ignore" })
		return true
	} catch {
		return false
	}
}

const sameArea = (left: HoverArea | null, right: HoverArea | null) => JSON.stringify(left) === JSON.stringify(right)

export function createKwinHoverFade(scriptDirectory: string) {
	const available = kwinScriptingAvailable()
	const scriptPath = path.join(scriptDirectory, `${SCRIPT_NAME}.js`)
	const resetPath = path.join(scriptDirectory, `${RESET_SCRIPT_NAME}.js`)
	let loadedArea: HoverArea | null = null
	/** Serialises qdbus calls so a load and an unload can never interleave. */
	let queue = Promise.resolve()

	const qdbus = (...args: string[]) =>
		new Promise<string>(resolve =>
			execFile("qdbus", args, { timeout: QDBUS_TIMEOUT_MS }, (_error, stdout) => resolve(String(stdout).trim())),
		)

	async function runScript(file: string, name: string) {
		await qdbus(...qdbusArgs("unloadScript", name))
		const id = await qdbus(...qdbusArgs("loadScript", file, name))
		if (/^\d+$/.test(id)) await qdbus("org.kde.KWin", `/Scripting/Script${id}`, "org.kde.kwin.Script.run")
	}

	async function load(area: HoverArea) {
		fs.mkdirSync(scriptDirectory, { recursive: true })
		fs.writeFileSync(scriptPath, hoverScript(area))
		await runScript(scriptPath, SCRIPT_NAME)
	}

	/** Scripts stay loaded in KWin until it restarts, so the fade script is removed and opacity restored. */
	async function unload() {
		await qdbus(...qdbusArgs("unloadScript", SCRIPT_NAME))
		fs.mkdirSync(scriptDirectory, { recursive: true })
		fs.writeFileSync(resetPath, resetScript)
		await runScript(resetPath, RESET_SCRIPT_NAME)
		await qdbus(...qdbusArgs("unloadScript", RESET_SCRIPT_NAME))
	}

	/** Called on every passthrough poll; only talks to KWin when the wanted state changes. */
	function update(active: boolean, area: HoverArea | null) {
		const wanted = active && area ? area : null
		if (sameArea(wanted, loadedArea)) return
		loadedArea = wanted
		queue = queue.then(() => (wanted ? load(wanted) : unload())).catch(() => {})
	}

	/** Synchronous cleanup for app quit, when async work would be cut off. */
	function dispose() {
		if (!available || !loadedArea) return
		loadedArea = null
		try {
			execFileSync("qdbus", qdbusArgs("unloadScript", SCRIPT_NAME), {
				timeout: QDBUS_TIMEOUT_MS,
				stdio: "ignore",
			})
		} catch {}
	}

	// A crash could have left the script running from a previous session.
	if (available) queue = unload().catch(() => {})

	return { available, update, dispose }
}
