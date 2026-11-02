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

class WuwaTappoApplication {
	private readonly appRoot = APP_ROOT
	private readonly catalog: { items: CatalogItem[]; filters: unknown }
	private readonly items: CatalogItem[]
	private readonly qa: boolean
	private readonly portable: string
	private readonly selfTest: boolean
	private readonly dataDirectory: string
	private readonly primaryInstance: boolean
	private readonly writeState: ReturnType<typeof storage.createWriter>
	private readonly inputManager: ReturnType<typeof createInputManager>
	private readonly windowManager: ReturnType<typeof createWindowManager>
	private state: CollectionState
	private saveWarning: string
	private pet: BrowserWindow | null = null
	private studio: BrowserWindow | null = null
	private tray: Tray | null = null
	private saveTimer: ReturnType<typeof setTimeout> | null = null
	private topTimer: ReturnType<typeof setInterval> | null = null
	private pointerTimer: ReturnType<typeof setInterval> | null = null
	private quitting = false

	constructor() {
		this.catalog = JSON.parse(fs.readFileSync(path.join(this.appRoot, "assets", "catalog.json"), "utf8")) as {
			items: CatalogItem[]
			filters: unknown
		}
		this.items = this.catalog.items
		this.qa = process.argv.includes("--qa")
		this.portable = app.isPackaged ? path.dirname(process.execPath) : this.appRoot
		this.selfTest =
			this.qa &&
			process.argv.includes("--selftest") &&
			!process.argv.includes("--snapshot") &&
			!process.argv.includes("--interactive-test")
		this.dataDirectory = this.qa
			? path.join(process.env.WUWA_QA_OUTPUT || path.join(this.appRoot, ".."), "qa-data-" + process.pid)
			: path.join(app.getPath("appData"), "wuwa-tappo")
		fs.mkdirSync(this.dataDirectory, { recursive: true })
		app.setName("Wuwa Tappo")
		app.setPath("userData", path.join(this.dataDirectory, "runtime"))
		this.primaryInstance = app.requestSingleInstanceLock()

		const savePath = path.join(this.dataDirectory, "collection.json")
		const profile =
			this.primaryInstance && !this.qa
				? storage.initProfile({
						dataDir: this.dataDirectory,
						portableDir: this.portable,
						searchRoots: [app.getPath("downloads")],
						items: this.items,
					})
				: { state: core.initial(this.items), warning: "" }
		this.state = profile.state
		this.saveWarning = profile.warning
		if (!this.qa) {
			for (const item of this.items) if (!this.state.owned[item.id]) this.state.owned[item.id] = 1
		}
		this.writeState = storage.createWriter(savePath)
		this.inputManager = createInputManager({
			state: this.state,
			items: this.items,
			getPet: () => this.pet,
			dataDir: this.dataDirectory,
			qa: this.qa,
			save: () => this.save(),
			laterSave: () => this.laterSave(),
			onStatus: () => this.broadcastStatus(),
		})
		this.windowManager = createWindowManager({
			preloadPath: path.join(__dirname, "preload.js"),
			rendererPath: path.join(this.appRoot, "renderer-build", "studio.html"),
			selfTest: this.selfTest,
			getState: () => this.state,
			getPet: () => this.pet,
			setPet: window => {
				this.pet = window
			},
			getStudio: () => this.studio,
			setStudio: window => {
				this.studio = window
			},
			getTray: () => this.tray,
			isQuitting: () => this.quitting,
			attachWindowInput: window => this.inputManager.attachWindowInput(window),
			getContextMenu: () => this.createTrayMenu(),
		})
	}

	start() {
		this.registerIpcHandlers()
		if (!this.primaryInstance) {
			app.quit()
			return
		}

		app.on("second-instance", () => {
			this.pet?.show()
			this.windowManager.showStudio()
		})
		app.whenReady().then(() => this.onReady())
		app.on("before-quit", event => this.onBeforeQuit(event))
		app.on("window-all-closed", () => app.quit())
	}

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

	private laterSave() {
		if (!this.saveTimer)
			this.saveTimer = setTimeout(() => {
				this.saveTimer = null
				void this.save()
			}, 3000)
	}

	private windows(): BrowserWindow[] {
		return [this.pet, this.studio].filter(
			(window): window is BrowserWindow => Boolean(window && !window.isDestroyed()),
		)
	}

	private broadcastState() {
		for (const window of this.windows()) window.webContents.send("state", this.state)
	}

	private broadcastStatus() {
		for (const window of this.windows())
			window.webContents.send("status", {
				hook: this.inputManager.status,
				warning: this.saveWarning,
			})
	}

	private createTrayMenu() {
		const menuItems: any[] = [
			{ label: "Collection and Outfits", click: () => this.windowManager.showStudio() },
			{
				label: "Show Pet / Reset to Screen Corner",
				click: () => {
					this.pet?.show()
					this.windowManager.placePet(true)
					void this.save()
				},
			},
			{
				label: "Mouse Passthrough",
				type: "checkbox",
				checked: this.state.settings.passthrough,
				click: () => {
					this.state.settings.passthrough = !this.state.settings.passthrough
					this.windowManager.applySettings()
					void this.save()
					this.broadcastState()
				},
			},
			{
				label: "Enable Keyboard and Mouse Input",
				type: "checkbox",
				checked: this.state.settings.inputEnabled,
				click: () => {
					this.state.settings.inputEnabled = !this.state.settings.inputEnabled
					this.windowManager.applySettings()
					void this.save()
					this.broadcastState()
				},
			},
		]
		if (process.platform === "linux" && !this.inputManager.status.includes("connected")) {
			menuItems.push({
				label: "⚡ Fix Input Permissions (Linux)",
				click: () => {
					exec("pkexec setfacl -m u:$USER:r /dev/input/event*", () => {
						this.inputManager.start()
						this.windowManager.applySettings()
					})
				},
			})
		}
		menuItems.push({ type: "separator" }, { label: "Exit Wuwa Tappo", click: () => app.quit() })
		return Menu.buildFromTemplate(menuItems)
	}

	private registerIpcHandlers() {
		ipcMain.handle("init", () => ({
			state: this.state,
			items: this.items,
			filters: this.catalog.filters,
			status: { hook: this.inputManager.status, warning: this.saveWarning },
			monitors: screen.getAllDisplays().map((display, index) => ({
				id: index,
				label: `Screen ${index + 1} · ${display.size.width}×${display.size.height}`,
			})),
		}))
		ipcMain.handle("command", (_event, name, argument) =>
			executeCommand(name, argument, {
				app,
				dialog,
				shell,
				dataDirectory: this.dataDirectory,
				items: this.items,
				getState: () => this.state,
				setState: next => {
					this.state = next
				},
				getPet: () => this.pet,
				getStudio: () => this.studio,
				showStudio: () => this.windowManager.showStudio(),
				resizeStudio: action => this.windowManager.resizeStudio(action),
				applySettings: () => this.windowManager.applySettings(),
				placePet: reset => this.windowManager.placePet(reset),
				save: () => this.save(),
				broadcast: () => this.broadcastState(),
				clearPressedKeys: () => this.inputManager.clearPressed(),
				input: (key, down, side) => this.inputManager.input(key, down, side),
				inputStatus: this.inputManager.status,
				saveWarning: () => this.saveWarning,
			}),
		)
		ipcMain.on("move", (_event, dx, dy) => this.movePet(dx, dy))
		ipcMain.on("resize-studio", (event, edge, dx, dy) => this.resizeStudio(event, edge, dx, dy))
	}

	private movePet(dx: number, dy: number) {
		if (
			!this.pet ||
			this.pet.isDestroyed() ||
			this.state.settings.passthrough ||
			this.state.settings.lockDrag ||
			!Number.isFinite(dx) ||
			!Number.isFinite(dy)
		)
			return
		const [x, y] = this.pet.getPosition()
		const nextX = Math.round(x + dx)
		const nextY = Math.round(y + dy)
		this.pet.setPosition(nextX, nextY)
		this.state.settings.petPosition = { x: nextX, y: nextY }
		this.laterSave()
	}

	private resizeStudio(event: Electron.IpcMainEvent, edge: string, dx: number, dy: number) {
		if (
			!this.studio ||
			event.sender !== this.studio.webContents ||
			!["n", "s", "e", "w", "ne", "nw", "se", "sw"].includes(edge) ||
			!Number.isFinite(dx) ||
			!Number.isFinite(dy)
		)
			return
		this.windowManager.clearStudioRestoreBounds()
		const bounds = this.studio.getBounds()
		if (edge.includes("e")) bounds.width += dx
		if (edge.includes("s")) bounds.height += dy
		if (edge.includes("w")) {
			bounds.x += dx
			bounds.width -= dx
		}
		if (edge.includes("n")) {
			bounds.y += dy
			bounds.height -= dy
		}
		this.studio.setBounds(this.windowManager.fitStudio(bounds))
	}

	private async onReady() {
		if (app.isPackaged || process.platform === "linux") {
			try {
				setAutoStart(this.state.settings.autoStart, app)
			} catch {
				this.saveWarning = "Failed to update launch-at-startup registration"
			}
		}
		session.defaultSession.webRequest.onBeforeRequest(
			{ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
			(_details, callback) => callback({ cancel: true }),
		)
		session.defaultSession.setPermissionRequestHandler((_, __, callback) => callback(false))
		this.pet = new BrowserWindow({
			width: 320,
			height: 350,
			transparent: true,
			frame: false,
			resizable: false,
			skipTaskbar: true,
			hasShadow: false,
			alwaysOnTop: this.state.settings.alwaysOnTop,
			type: process.platform === "linux" ? "dock" : "normal",
			title: "Wuwa Tappo · Desktop Pet",
			webPreferences: {
				preload: path.join(__dirname, "preload.js"),
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				offscreen: this.selfTest,
				backgroundThrottling: false,
			},
		})
		this.inputManager.attachWindowInput(this.pet)
		this.windowManager.secureWindow(this.pet)
		this.pet.loadFile(path.join(this.appRoot, "renderer-build", "pet.html"))
		this.pet.webContents.once("did-finish-load", () =>
			setTimeout(() => {
				this.windowManager.applySkipTaskbar()
				this.pet?.showInactive()
			}, 300),
		)
		this.pet.on("closed", () => {
			this.pet = null
		})
		this.windowManager.placePet()
		this.windowManager.applySettings()
		const reapplyWindowBehavior = () => {
			this.windowManager.applySkipTaskbar()
			setTimeout(() => this.windowManager.keepPetOnTop(), 0)
		}
		this.pet.on("show", reapplyWindowBehavior)
		this.pet.on("restore", reapplyWindowBehavior)
		this.pet.on("blur", reapplyWindowBehavior)
		this.topTimer = setInterval(() => this.windowManager.keepPetOnTop(), 3000)
		this.pointerTimer = setInterval(() => this.windowManager.updateMousePassthrough(), 80)
		const icon = nativeImage
			.createFromPath(path.join(this.appRoot, "assets", "appicon.png"))
			.resize({ width: 24, height: 24 })
		this.tray = new Tray(icon)
		this.tray.setToolTip("Wuwa Tappo · Desktop Companion")
		this.tray.setContextMenu(this.createTrayMenu())
		this.tray.on("click", () => this.windowManager.showStudio())
		globalShortcut.register("CommandOrControl+Alt+P", () => {
			this.state.settings.passthrough = !this.state.settings.passthrough
			this.windowManager.applySettings()
			void this.save()
			this.broadcastState()
		})
		globalShortcut.register("F8", () => {
			this.state.settings.monitor = (this.state.settings.monitor + 1) % screen.getAllDisplays().length
			this.windowManager.placePet()
			void this.save()
			this.broadcastState()
		})
		screen.on("display-removed", () => this.windowManager.placePet())
		screen.on("display-metrics-changed", () => this.windowManager.placePet())
		this.inputManager.start()
		void this.save()
		if (this.qa || process.argv.includes("--studio") || (this.state.draws === 0 && this.state.presets.length === 0))
			this.windowManager.showStudio()
		if (this.selfTest) {
			for (const window of [this.pet, this.studio]) {
				if (!window) continue
				window.hide()
				window.show = () => {}
				window.showInactive = () => {}
				window.focus = () => {}
			}
		}
		if (this.qa) {
			Object.assign(global, {
				__QA: {
					state: () => this.state,
					pet: () => this.pet,
					studio: () => this.studio,
					hook: () => this.inputManager.status,
					input: this.inputManager.input,
				},
			})
			if (process.argv.includes("--selftest"))
				runQa({
					app,
					pet: this.pet!,
					studio: this.studio!,
					items: this.items,
					getState: () => this.state,
					dataDir: this.dataDirectory,
					input: this.inputManager.input,
				})
		}
	}

	private onBeforeQuit(event: Electron.Event) {
		if (this.quitting) return
		event.preventDefault()
		this.quitting = true
		if (this.saveTimer) clearTimeout(this.saveTimer)
		if (this.topTimer) clearInterval(this.topTimer)
		if (this.pointerTimer) clearInterval(this.pointerTimer)
		this.inputManager.stop()
		globalShortcut.unregisterAll()
		void this.save().finally(() => app.quit())
	}
}

new WuwaTappoApplication().start()
