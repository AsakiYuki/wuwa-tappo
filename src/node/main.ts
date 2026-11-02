import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	screen,
	Tray,
	Menu,
	nativeImage,
	globalShortcut,
	session,
	shell,
} from "electron"
import fs from "node:fs"
import path from "node:path"
import { exec } from "node:child_process"
import type { CatalogItem, CollectionState } from "./types.js"
import * as core from "./core.js"
import * as storage from "./storage.js"
import { runQa } from "./qa.js"
import { createInputManager } from "./input-manager.js"
import { executeCommand } from "./commands.js"
import { createWindowManager } from "./window-manager.js"
import { setAutoStart } from "./autostart.js"

if (process.platform === "linux") {
	try {
		if (
			!process.argv.some(argument => argument === "--ozone-platform" || argument.startsWith("--ozone-platform=")) &&
			!process.env.ELECTRON_OZONE_PLATFORM_HINT
		) {
			app.relaunch({
				args: [...process.argv.slice(1), "--ozone-platform=x11"],
			})
			app.exit(0)
		}
		app.commandLine.appendSwitch("enable-features", "WaylandWindowDecorations")
	} catch {
		// Electron may already have initialized its command line.
	}
}
const APP_ROOT = path.resolve(__dirname, "..")
const catalog = JSON.parse(fs.readFileSync(path.join(APP_ROOT, "assets", "catalog.json"), "utf8")) as {
	items: CatalogItem[]
	filters: unknown
}
const items = catalog.items
const QA = process.argv.includes("--qa"),
	PORTABLE = app.isPackaged ? path.dirname(process.execPath) : APP_ROOT
const SELFTEST =
	QA &&
	process.argv.includes("--selftest") &&
	!process.argv.includes("--snapshot") &&
	!process.argv.includes("--interactive-test")
const dataDir = QA
	? path.join(process.env.WUWA_QA_OUTPUT || path.join(APP_ROOT, ".."), "qa-data-" + process.pid)
	: path.join(app.getPath("appData"), "wuwa-tappo")
fs.mkdirSync(dataDir, { recursive: true })
app.setName("Wuwa Tappo")
app.setPath("userData", path.join(dataDir, "runtime"))
const primaryInstance = app.requestSingleInstanceLock()
const savePath = path.join(dataDir, "collection.json"),
	profile =
		primaryInstance && !QA
			? storage.initProfile({
					dataDir,
					portableDir: PORTABLE,
					searchRoots: [app.getPath("downloads")],
					items,
				})
			: { state: core.initial(items), warning: "" }
let state: CollectionState = profile.state,
	saveWarning = profile.warning
if (!QA) {
	for (const it of items) if (!state.owned[it.id]) state.owned[it.id] = 1
}
let pet: BrowserWindow | null = null
let studio: BrowserWindow | null = null
let tray: Tray | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let topTimer: ReturnType<typeof setInterval> | null = null
let pointerTimer: ReturnType<typeof setInterval> | null = null
let quitting = false
const writeState = storage.createWriter(savePath)
const inputManager = createInputManager({
	state,
	items,
	getPet: () => pet ?? null,
	dataDir,
	qa: QA,
	save,
	laterSave,
	onStatus: () => status(),
})
async function save() {
	try {
		await writeState(state)
		return true
	} catch (e) {
		saveWarning = "Failed to save collection, please check folder permissions"
		status()
		return false
	}
}
function laterSave() {
	if (!saveTimer)
		saveTimer = setTimeout(() => {
			saveTimer = null
			save()
		}, 3000)
}
function windows() {
	return [pet, studio].filter(w => w && !w.isDestroyed())
}
function broadcast() {
	for (const w of windows()) w.webContents.send("state", state)
}
function status() {
	for (const w of windows())
		w.webContents.send("status", {
			hook: inputManager.status,
			warning: saveWarning,
		})
}
const windowManager = createWindowManager({
	preloadPath: path.join(__dirname, "preload.js"),
	rendererPath: path.join(APP_ROOT, "renderer-build", "studio.html"),
	selfTest: SELFTEST,
	getState: () => state,
	getPet: () => pet ?? null,
	setPet: window => {
		pet = window
	},
	getStudio: () => studio ?? null,
	setStudio: window => {
		studio = window
	},
	getTray: () => tray ?? null,
	isQuitting: () => quitting,
	attachWindowInput: window => inputManager.attachWindowInput(window),
	getContextMenu: () => menu(),
})
const {
	placePet: place,
	applySettings,
	applySkipTaskbar,
	keepPetOnTop,
	updateMousePassthrough: pointerMode,
	fitStudio,
	resizeStudio: studioWindow,
	secureWindow: secure,
	showStudio,
	clearStudioRestoreBounds,
} = windowManager

function menu() {
	const items: any[] = [
		{ label: "Collection and Outfits", click: showStudio },
		{
			label: "Show Pet / Reset to Screen Corner",
			click: () => {
				pet.show()
				place(true)
				save()
			},
		},
		{
			label: "Mouse Passthrough",
			type: "checkbox",
			checked: state.settings.passthrough,
			click: () => {
				state.settings.passthrough = !state.settings.passthrough
				applySettings()
				save()
				broadcast()
			},
		},
		{
			label: "Enable Keyboard and Mouse Input",
			type: "checkbox",
			checked: state.settings.inputEnabled,
			click: () => {
				state.settings.inputEnabled = !state.settings.inputEnabled
				applySettings()
				save()
				broadcast()
			},
		},
	]
	if (process.platform === "linux" && !inputManager.status.includes("connected")) {
		items.push({
			label: "⚡ Fix Input Permissions (Linux)",
			click: () => {
				exec("pkexec setfacl -m u:$USER:r /dev/input/event*", () => {
					inputManager.start()
					applySettings()
				})
			},
		})
	}
	items.push({ type: "separator" }, { label: "Exit Wuwa Tappo", click: () => app.quit() })
	return Menu.buildFromTemplate(items)
}
ipcMain.handle("init", () => ({
	state,
	items,
	filters: catalog.filters,
	status: { hook: inputManager.status, warning: saveWarning },
	monitors: screen.getAllDisplays().map((d, i) => ({
		id: i,
		label: `Screen ${i + 1} · ${d.size.width}×${d.size.height}`,
	})),
}))
ipcMain.handle("command", (_event, name, argument) =>
	executeCommand(name, argument, {
		app,
		dialog,
		shell,
		dataDirectory: dataDir,
		items,
		getState: () => state,
		setState: next => {
			state = next
		},
		getPet: () => pet ?? null,
		getStudio: () => studio ?? null,
		showStudio,
		resizeStudio: studioWindow,
		applySettings,
		placePet: place,
		save,
		broadcast,
		clearPressedKeys: inputManager.clearPressed,
		input: inputManager.input,
		inputStatus: inputManager.status,
		saveWarning: () => saveWarning,
	}),
)
ipcMain.on("move", (_, dx, dy) => {
	if (
		!pet ||
		pet.isDestroyed() ||
		state.settings.passthrough ||
		state.settings.lockDrag ||
		!Number.isFinite(dx) ||
		!Number.isFinite(dy)
	)
		return
	const [x, y] = pet.getPosition()
	const nx = Math.round(x + dx)
	const ny = Math.round(y + dy)
	pet.setPosition(nx, ny)
	state.settings.petPosition = { x: nx, y: ny }
	laterSave()
})
ipcMain.on("resize-studio", (event, edge, dx, dy) => {
	if (
		!studio ||
		event.sender !== studio.webContents ||
		!["n", "s", "e", "w", "ne", "nw", "se", "sw"].includes(edge) ||
		!Number.isFinite(dx) ||
		!Number.isFinite(dy)
	)
		return
	clearStudioRestoreBounds()
	const b = studio.getBounds()
	if (edge.includes("e")) b.width += dx
	if (edge.includes("s")) b.height += dy
	if (edge.includes("w")) {
		b.x += dx
		b.width -= dx
	}
	if (edge.includes("n")) {
		b.y += dy
		b.height -= dy
	}
	studio.setBounds(fitStudio(b))
})
if (!primaryInstance) {
	app.quit()
} else {
	app.on("second-instance", () => {
		pet?.show()
		showStudio()
	})
	app.whenReady().then(async () => {
		if (app.isPackaged || process.platform === "linux") {
			try {
				setAutoStart(state.settings.autoStart, app)
			} catch {
				saveWarning = "Failed to update launch-at-startup registration"
			}
		}
		session.defaultSession.webRequest.onBeforeRequest(
			{ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
			(_details, callback) => callback({ cancel: true }),
		)
		session.defaultSession.setPermissionRequestHandler((_, __, callback) => callback(false))
		pet = new BrowserWindow({
			width: 320,
			height: 350,
			transparent: true,
			frame: false,
			resizable: false,
			skipTaskbar: true,
			hasShadow: false,
			alwaysOnTop: state.settings.alwaysOnTop,
			type: process.platform === "linux" ? "dock" : "normal",
			title: "Wuwa Tappo · Desktop Pet",
			webPreferences: {
				preload: path.join(__dirname, "preload.js"),
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				offscreen: SELFTEST,
				backgroundThrottling: false,
			},
		})
		inputManager.attachWindowInput(pet)
		secure(pet)
		pet.loadFile(path.join(APP_ROOT, "renderer-build", "pet.html"))
		pet.webContents.once("did-finish-load", () =>
			setTimeout(() => {
				applySkipTaskbar()
				pet.showInactive()
			}, 300),
		)
		pet.on("closed", () => {
			pet = null
		})
		place()
		applySettings()
		const reapplyWindowBehavior = () => {
			applySkipTaskbar()
			setTimeout(keepPetOnTop, 0)
		}
		pet.on("show", reapplyWindowBehavior)
		pet.on("restore", reapplyWindowBehavior)
		pet.on("blur", reapplyWindowBehavior)
		topTimer = setInterval(keepPetOnTop, 3000)
		pointerTimer = setInterval(pointerMode, 80)
		const icon = nativeImage
			.createFromPath(path.join(APP_ROOT, "assets", "appicon.png"))
			.resize({ width: 24, height: 24 })
		tray = new Tray(icon)
		tray.setToolTip("Wuwa Tappo · Desktop Companion")
		tray.setContextMenu(menu())
		tray.on("click", showStudio)
		globalShortcut.register("CommandOrControl+Alt+P", () => {
			state.settings.passthrough = !state.settings.passthrough
			applySettings()
			save()
			broadcast()
		})
		globalShortcut.register("F8", () => {
			state.settings.monitor = (state.settings.monitor + 1) % screen.getAllDisplays().length
			place()
			save()
			broadcast()
		})
		screen.on("display-removed", () => place())
		screen.on("display-metrics-changed", () => place())
		inputManager.start()
		save()
		if (QA || process.argv.includes("--studio") || (state.draws === 0 && state.presets.length === 0)) showStudio()
		if (SELFTEST) {
			for (const w of [pet, studio]) {
				w.hide()
				w.show = () => {}
				w.showInactive = () => {}
				w.focus = () => {}
			}
		}
		if (QA) {
			global.__QA = {
				state: () => state,
				pet: () => pet,
				studio: () => studio,
				hook: () => inputManager.status,
				input: inputManager.input,
			}
			if (process.argv.includes("--selftest"))
				runQa({
					app,
					pet,
					studio,
					items,
					getState: () => state,
					dataDir,
					input: inputManager.input,
				})
		}
	})
	app.on("before-quit", e => {
		if (quitting) return
		e.preventDefault()
		quitting = true
		clearTimeout(saveTimer)
		clearInterval(topTimer)
		clearInterval(pointerTimer)

		inputManager.stop()
		globalShortcut.unregisterAll()
		save().finally(() => app.quit())
	})
	app.on("window-all-closed", () => app.quit())
}
