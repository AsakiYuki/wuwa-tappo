import { app, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, session, shell, Tray } from "electron"
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { setAutoStart } from "./autostart.js"
import { executeCommand, type CommandContext } from "./commands.js"
import * as core from "./core.js"
import { createInputManager } from "./input-manager.js"
import { runQa } from "./qa.js"
import * as storage from "./storage.js"
import type { Catalog, CollectionState, HoverArea, InitPayload, ResizeEdge, Settings } from "./types.js"
import { createWindowManager } from "./window-manager.js"

const APP_ROOT = path.resolve(__dirname, "..")
/** Must match `build.appId`: Windows groups taskbar entries and notifications by it. */
const APP_USER_MODEL_ID = "com.asakiyuki.wuwa-tappo"
const DEFERRED_SAVE_MS = 3000
const KEEP_ON_TOP_INTERVAL_MS = 3000
const PASSTHROUGH_POLL_MS = 80
/** The pet window only needs these; everything else (import, export, reset, settings) is studio-only. */
const PET_COMMANDS = new Set(["tap", "emote", "open"])

/** Command-line switches. `--qa` uses a throwaway profile; `--selftest` alone also runs headless. */
const launch = {
	qa: process.argv.includes("--qa"),
	runQa: process.argv.includes("--qa") && process.argv.includes("--selftest"),
	headless:
		process.argv.includes("--qa") &&
		process.argv.includes("--selftest") &&
		!process.argv.includes("--snapshot") &&
		!process.argv.includes("--interactive-test"),
	openStudio: process.argv.includes("--studio"),
}

/** Global input hooks and transparent windows only work under X11, so Linux relaunches itself with it. */
function forceX11OnLinux() {
	if (process.platform !== "linux") return
	try {
		const ozoneChosen =
			process.argv.some(
				argument => argument === "--ozone-platform" || argument.startsWith("--ozone-platform="),
			) || Boolean(process.env.ELECTRON_OZONE_PLATFORM_HINT)
		if (!ozoneChosen) {
			app.relaunch({ args: [...process.argv.slice(1), "--ozone-platform=x11"] })
			app.exit(0)
		}
		app.commandLine.appendSwitch("enable-features", "WaylandWindowDecorations")
	} catch {
		// Electron may already have initialized its command line.
	}
}

/** Blocks every network request and permission prompt: the app is fully offline. */
function lockDownSession() {
	session.defaultSession.webRequest.onBeforeRequest(
		{ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
		(_details, callback) => callback({ cancel: true }),
	)
	session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
}

/** Electron's portable Windows build runs from a temp folder; this is where the user keeps the .exe. */
function portableDirectory() {
	if (process.platform === "win32" && process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR
	return app.isPackaged ? path.dirname(process.execPath) : APP_ROOT
}

/** Windows draws tray icons at 16 px (scaled by DPI); Linux and macOS panels use larger ones. */
const TRAY_ICON_SIZE = process.platform === "win32" ? 16 : 24

function trayIconPath() {
	const devIcon = path.join(APP_ROOT, "assets", "appicon.png")
	return fs.existsSync(devIcon) ? devIcon : path.join(path.dirname(process.resourcesPath), "appicon.png")
}

class WuwaTappoApplication {
	private readonly catalog: Catalog
	private readonly dataDirectory: string
	private readonly primaryInstance: boolean
	private readonly writeState: (state: CollectionState) => Promise<void>
	private readonly input: ReturnType<typeof createInputManager>
	private readonly windows: ReturnType<typeof createWindowManager>
	private state: CollectionState
	private saveWarning: string
	private tray: Tray | null = null
	private saveTimer: NodeJS.Timeout | null = null
	private intervals: NodeJS.Timeout[] = []
	private quitting = false

	constructor() {
		this.catalog = JSON.parse(fs.readFileSync(path.join(APP_ROOT, "assets", "catalog.json"), "utf8")) as Catalog
		this.dataDirectory = launch.qa
			? path.join(process.env.WUWA_QA_OUTPUT || path.join(APP_ROOT, ".."), "qa-data-" + process.pid)
			: path.join(app.getPath("appData"), "wuwa-tappo")
		fs.mkdirSync(this.dataDirectory, { recursive: true })
		app.setName("Wuwa Tappo")
		if (process.platform === "win32") app.setAppUserModelId(APP_USER_MODEL_ID)
		app.setPath("userData", path.join(this.dataDirectory, "runtime"))
		this.primaryInstance = app.requestSingleInstanceLock()

		const profile = this.loadProfile()
		this.state = profile.state
		this.saveWarning = profile.warning
		this.writeState = storage.createWriter(path.join(this.dataDirectory, "collection.json"))

		this.input = createInputManager({
			getState: () => this.state,
			items: this.items,
			getPet: () => this.windows.pet,
			dataDir: this.dataDirectory,
			qa: launch.qa,
			save: () => this.save(),
			laterSave: () => this.saveLater(),
			onStatus: () => this.broadcastStatus(),
		})
		this.windows = createWindowManager({
			preloadPath: path.join(__dirname, "preload.js"),
			petPagePath: path.join(APP_ROOT, "renderer-build", "pet.html"),
			studioPagePath: path.join(APP_ROOT, "renderer-build", "studio.html"),
			scriptDirectory: path.join(this.dataDirectory, "runtime"),
			selfTest: launch.headless,
			getState: () => this.state,
			getTray: () => this.tray,
			createTrayMenu: () => this.createTrayMenu(),
			isQuitting: () => this.quitting,
			onWindowCreated: window => this.input.attachWindowInput(window),
			onPetMoved: () => this.saveLater(),
		})
	}

	private get items() {
		return this.catalog.items
	}

	/** QA and secondary instances start from a fresh profile and never touch the real save. */
	private loadProfile() {
		if (!this.primaryInstance || launch.qa) return { state: core.initial(this.items), warning: "" }
		const profile = storage.initProfile({
			dataDir: this.dataDirectory,
			portableDir: portableDirectory(),
			searchRoots: [app.getPath("downloads")],
			items: this.items,
		})
		// Every item is unlocked outside of QA.
		for (const item of this.items) if (!profile.state.owned[item.id]) profile.state.owned[item.id] = 1
		return profile
	}

	start() {
		this.registerIpcHandlers()
		if (!this.primaryInstance) {
			app.quit()
			return
		}
		app.on("second-instance", () => {
			this.windows.pet?.show()
			this.windows.showStudio()
		})
		app.whenReady().then(() => this.onReady())
		app.on("before-quit", event => this.onBeforeQuit(event))
		app.on("window-all-closed", () => app.quit())
	}

	/* ------------------------------ persistence ------------------------------ */

	private async save() {
		try {
			await this.writeState(this.state)
			return true
		} catch {
			this.saveWarning = "Failed to save collection, please check folder permissions"
			this.broadcastStatus()
			return false
		}
	}

	/** Coalesces frequent changes (taps, dragging) into one save a few seconds later. */
	private saveLater() {
		if (this.saveTimer) return
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null
			void this.save()
		}, DEFERRED_SAVE_MS)
	}

	private broadcastState() {
		for (const window of this.windows.windows()) window.webContents.send("state", this.state)
	}

	private broadcastStatus() {
		const status = { hook: this.input.status, warning: this.saveWarning }
		for (const window of this.windows.windows()) window.webContents.send("status", status)
	}

	/** Applies a settings change made outside the renderer (tray, global shortcut) and syncs every window. */
	private changeSettings(mutate: (settings: Settings) => void, { placePet = false } = {}) {
		mutate(this.state.settings)
		if (placePet) this.windows.placePet()
		else this.windows.applySettings()
		void this.save()
		this.broadcastState()
	}

	private toggleSetting(key: "passthrough" | "inputEnabled") {
		this.changeSettings(settings => {
			settings[key] = !settings[key]
		})
	}

	/* ----------------------------------- ipc ---------------------------------- */

	private commandContext(): CommandContext {
		return {
			app,
			dialog,
			shell,
			dataDirectory: this.dataDirectory,
			items: this.items,
			getState: () => this.state,
			setState: next => (this.state = next),
			getPet: () => this.windows.pet,
			getStudio: () => this.windows.studio,
			showStudio: () => this.windows.showStudio(),
			resizeStudio: action => this.windows.resizeStudio(action),
			applySettings: () => this.windows.applySettings(),
			placePet: reset => this.windows.placePet(reset),
			save: () => this.save(),
			broadcast: () => this.broadcastState(),
			clearPressedKeys: () => this.input.clearPressed(),
			input: (key, down, side) => this.input.input(key, down, side),
			isInputHookConnected: () => this.input.connected,
			saveWarning: () => this.saveWarning,
		}
	}

	private initPayload(): InitPayload {
		return {
			state: this.state,
			items: this.items,
			filters: this.catalog.filters,
			status: { hook: this.input.status, warning: this.saveWarning },
			monitors: screen.getAllDisplays().map((display, index) => ({
				id: index,
				label: `Screen ${index + 1} · ${display.size.width}×${display.size.height}`,
			})),
		}
	}

	private registerIpcHandlers() {
		ipcMain.handle("init", () => this.initPayload())
		ipcMain.handle("command", (event, name: string, argument: unknown) => {
			const fromStudio = event.sender === this.windows.studio?.webContents
			const fromPet = event.sender === this.windows.pet?.webContents
			if (!fromStudio && !(fromPet && PET_COMMANDS.has(name)))
				return { ok: false, error: "Command not allowed from this window" }
			return executeCommand(name, argument, this.commandContext())
		})
		ipcMain.on("move", (event, dx: number, dy: number) => {
			if (event.sender === this.windows.pet?.webContents) this.windows.movePet(dx, dy)
		})
		ipcMain.on("hover-area", (event, area: HoverArea) => {
			if (event.sender === this.windows.pet?.webContents) this.windows.setHoverArea(area)
		})
		ipcMain.on("resize-studio", (event, edge: ResizeEdge, dx: number, dy: number) =>
			this.windows.resizeStudioEdge(event.sender, edge, dx, dy),
		)
	}

	/* ------------------------------ tray & shortcuts ------------------------------ */

	private createTrayMenu() {
		const settings = this.state.settings
		const template: Electron.MenuItemConstructorOptions[] = [
			{ label: "Collection and Outfits", click: () => this.windows.showStudio() },
			{
				label: "Show Pet / Reset to Screen Corner",
				click: () => {
					this.windows.pet?.show()
					this.windows.placePet(true)
					void this.save()
				},
			},
			{
				label: "Mouse Passthrough",
				type: "checkbox",
				checked: settings.passthrough,
				click: () => this.toggleSetting("passthrough"),
			},
			{
				label: "Enable Keyboard and Mouse Input",
				type: "checkbox",
				checked: settings.inputEnabled,
				click: () => this.toggleSetting("inputEnabled"),
			},
		]
		const permissionFix = this.inputPermissionMenuItem()
		if (permissionFix) template.push(permissionFix)
		template.push({ type: "separator" }, { label: "Exit Wuwa Tappo", click: () => app.quit() })
		return Menu.buildFromTemplate(template)
	}

	/** Offers a one-click fix while no global input hook could connect. */
	private inputPermissionMenuItem(): Electron.MenuItemConstructorOptions | null {
		if (this.input.connected) return null
		if (process.platform === "linux")
			return {
				label: "⚡ Fix Input Permissions (Linux)",
				click: () => void this.grantLinuxInputAccess(),
			}
		if (process.platform === "darwin")
			return {
				label: "⚡ Open Accessibility Settings (macOS)",
				click: () =>
					void shell.openExternal(
						"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
					),
			}
		return null
	}

	/**
	 * Grants this user read access to /dev/input after an explicit warning: any program the user runs
	 * can then read raw keystrokes, so it must never happen silently. No shell is involved, and the
	 * user name comes from the OS rather than the (spoofable) $USER variable.
	 */
	private async grantLinuxInputAccess() {
		const { response } = await dialog.showMessageBox({
			type: "warning",
			buttons: ["Cancel", "Grant Access"],
			defaultId: 0,
			cancelId: 0,
			title: "Grant Input Access",
			message: "Allow reading keyboard and mouse devices?",
			detail:
				"Wuwa Tappo needs read access to /dev/input to see global key presses on Wayland. " +
				"This access applies to every program running as your user, not only Wuwa Tappo, " +
				"and lasts until the devices are re-created (usually until reboot).",
		})
		if (response !== 1) return

		let devices: string[]
		try {
			devices = fs
				.readdirSync("/dev/input")
				.filter(name => /^event\d+$/.test(name))
				.map(name => path.join("/dev/input", name))
		} catch {
			devices = []
		}
		if (!devices.length) return

		const user = os.userInfo().username
		execFile("pkexec", ["setfacl", "-m", `u:${user}:r`, ...devices], () => {
			this.input.start()
			this.windows.applySettings()
		})
	}

	private createTray() {
		const iconPath = trayIconPath()
		if (process.platform === "darwin") app.dock?.setIcon(iconPath)
		const icon = nativeImage.createFromPath(iconPath)
		this.tray = new Tray(icon.resize({ width: TRAY_ICON_SIZE, height: TRAY_ICON_SIZE, quality: "best" }))
		this.tray.setToolTip("Wuwa Tappo · Desktop Companion")
		this.tray.setContextMenu(this.createTrayMenu())
		this.tray.on("click", () => this.windows.showStudio())
	}

	private registerShortcuts() {
		globalShortcut.register("CommandOrControl+Alt+P", () => this.toggleSetting("passthrough"))
		globalShortcut.register("F8", () =>
			this.changeSettings(
				settings => {
					settings.monitor = (settings.monitor + 1) % screen.getAllDisplays().length
				},
				{ placePet: true },
			),
		)
		screen.on("display-removed", () => this.windows.placePet())
		screen.on("display-metrics-changed", () => this.windows.placePet())
	}

	/* -------------------------------- lifecycle ------------------------------- */

	private syncAutoStart() {
		if (!app.isPackaged && process.platform !== "linux") return
		try {
			setAutoStart(this.state.settings.autoStart, app)
		} catch {
			this.saveWarning = "Failed to update launch-at-startup registration"
		}
	}

	private onReady() {
		this.syncAutoStart()
		lockDownSession()
		this.windows.createPet()
		this.intervals.push(
			setInterval(() => this.windows.keepPetOnTop(), KEEP_ON_TOP_INTERVAL_MS),
			setInterval(() => this.windows.updateMousePassthrough(), PASSTHROUGH_POLL_MS),
		)
		this.createTray()
		this.registerShortcuts()
		this.input.start()
		void this.save()

		const firstRun = this.state.draws === 0 && this.state.presets.length === 0
		if (launch.qa || launch.openStudio || firstRun) this.windows.showStudio()
		if (launch.qa) this.startQa()
	}

	private startQa() {
		const { pet, studio } = this.windows
		if (launch.headless) {
			// Keep headless windows hidden even when app code asks to show them.
			for (const window of [pet, studio]) {
				if (!window) continue
				window.hide()
				window.show = () => {}
				window.showInactive = () => {}
				window.focus = () => {}
			}
		}
		Object.assign(global, {
			__QA: {
				state: () => this.state,
				pet: () => this.windows.pet,
				studio: () => this.windows.studio,
				hook: () => this.input.status,
				input: this.input.input,
			},
		})
		if (launch.runQa)
			void runQa({
				app,
				pet,
				studio,
				items: this.items,
				getState: () => this.state,
				dataDir: this.dataDirectory,
				input: this.input.input,
			})
	}

	/** Flushes the save before quitting; the first quit is deferred until the write finishes. */
	private onBeforeQuit(event: Electron.Event) {
		if (this.quitting) return
		event.preventDefault()
		this.quitting = true
		if (this.saveTimer) clearTimeout(this.saveTimer)
		this.intervals.forEach(clearInterval)
		this.input.stop()
		this.windows.dispose()
		globalShortcut.unregisterAll()
		void this.save().finally(() => app.quit())
	}
}

forceX11OnLinux()
new WuwaTappoApplication().start()
