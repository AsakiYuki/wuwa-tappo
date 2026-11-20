import { BrowserWindow, screen, type Rectangle, type Tray, type WebPreferences } from "electron"
import { createKwinHoverFade } from "./kwin-hover-fade.js"
import { PET_WINDOW_TITLE, skipTaskbarOnX11, updateKdeWindowRule } from "./linux-window.js"
import { RESIZE_EDGES, type CollectionState, type CursorMessage, type HoverArea, type ResizeEdge } from "./types.js"

interface WindowManagerOptions {
	preloadPath: string
	petPagePath: string
	studioPagePath: string
	/** Where generated helper scripts (KWin hover-fade) are written. */
	scriptDirectory: string
	/** App icon for taskbar buttons; without it, an unpackaged run shows Electron's own icon. */
	iconPath: string
	/** Self-tests render offscreen so no window ever appears. */
	selfTest: boolean
	getState(): CollectionState
	getTray(): Tray | null
	createTrayMenu(): Electron.Menu
	isQuitting(): boolean
	/** Called for every new window so in-window key events can feed the input fallback. */
	onWindowCreated(window: BrowserWindow): void
	/** Called when the user drags the pet somewhere new. */
	onPetMoved(): void
}

/** Pet window size at scale 1, with and without the keyboard. */
const PET_SIZE = { withKeyboard: { width: 320, height: 350 }, compact: { width: 225, height: 215 } }
const PET_CORNER_MARGIN = { right: 24, bottom: 12 }
const STUDIO_SIZE = { width: 1100, height: 756 }
const STUDIO_MIN_SIZE = { width: 680, height: 468 }
const STUDIO_ZOOM_STEP = 1.1
/** Delay before showing a freshly loaded window, so it never flashes an empty frame. */
const PET_SHOW_DELAY_MS = 300
const STUDIO_SHOW_DELAY_MS = 200
/**
 * Linux: a dock window stays out of the taskbar and above normal windows.
 * Windows: a toolbar window has no taskbar button and is skipped by Alt+Tab.
 */
const PET_WINDOW_TYPE = process.platform === "linux" ? "dock" : process.platform === "win32" ? "toolbar" : "normal"
/** Workspaces only exist on macOS and Linux; Electron ignores the call elsewhere. */
const HAS_WORKSPACES = process.platform === "darwin" || process.platform === "linux"

export function createWindowManager(options: WindowManagerOptions) {
	let pet: BrowserWindow | null = null
	let studio: BrowserWindow | null = null
	let lastIgnoreMouseEvents: boolean | undefined
	let trackingCursor = false
	/** Bounds to restore when "maximize" is toggled off. */
	let studioRestoreBounds: Rectangle | null = null
	/** Reported by the pet renderer; used for hover-fade hit testing outside the page. */
	let hoverArea: HoverArea | null = null
	const kwinHoverFade = createKwinHoverFade(options.scriptDirectory)

	const settings = () => options.getState().settings
	const usable = (window: BrowserWindow | null) => (window && !window.isDestroyed() ? window : null)

	const webPreferences = (extra: WebPreferences = {}): WebPreferences => ({
		preload: options.preloadPath,
		contextIsolation: true,
		nodeIntegration: false,
		sandbox: true,
		offscreen: options.selfTest,
		...extra,
	})

	/** Windows never open popups or navigate away from the bundled page. */
	function secureWindow(window: BrowserWindow) {
		window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
		window.webContents.on("will-navigate", event => event.preventDefault())
	}

	/* ---------------------------------- pet ---------------------------------- */

	function createPet() {
		const window = new BrowserWindow({
			...PET_SIZE.withKeyboard,
			transparent: true,
			frame: false,
			resizable: false,
			skipTaskbar: true,
			hasShadow: false,
			alwaysOnTop: settings().alwaysOnTop,
			type: PET_WINDOW_TYPE,
			title: PET_WINDOW_TITLE,
			icon: options.iconPath,
			webPreferences: webPreferences({ backgroundThrottling: false }),
		})
		pet = window
		options.onWindowCreated(window)
		secureWindow(window)
		window.loadFile(options.petPagePath)
		window.webContents.once("did-finish-load", () =>
			setTimeout(() => {
				applySkipTaskbar()
				usable(pet)?.showInactive()
			}, PET_SHOW_DELAY_MS),
		)
		window.on("closed", () => (pet = null))

		// Window managers drop these hints on several events; re-apply them each time.
		const reapplyWindowBehavior = () => {
			applySkipTaskbar()
			setTimeout(keepPetOnTop, 0)
		}
		window.on("show", reapplyWindowBehavior)
		window.on("restore", reapplyWindowBehavior)
		window.on("blur", reapplyWindowBehavior)

		placePet()
		applySettings()
		return window
	}

	function activeDisplay() {
		return screen.getAllDisplays()[settings().monitor] ?? screen.getPrimaryDisplay()
	}

	/** Sizes the pet for the current scale and moves it to its saved spot, or the bottom-right corner. */
	function placePet(resetToCorner = false) {
		const window = usable(pet)
		if (!window) return

		const current = settings()
		const size = current.showKeyboard ? PET_SIZE.withKeyboard : PET_SIZE.compact
		const width = Math.round(size.width * current.scale)
		const height = Math.round(size.height * current.scale)
		const saved = current.petPosition
		const hasSavedPosition = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)

		let x: number
		let y: number
		if (!resetToCorner && hasSavedPosition) {
			x = Math.round(saved.x)
			y = Math.round(saved.y)
		} else {
			const area = activeDisplay().workArea
			x = area.x + area.width - width - PET_CORNER_MARGIN.right
			y = area.y + area.height - height - PET_CORNER_MARGIN.bottom
		}
		window.setBounds({ x, y, width, height })
		current.petPosition = { x, y }
	}

	/** Moves the pet by a drag delta from the renderer, unless dragging is disabled. */
	function movePet(dx: number, dy: number) {
		const window = usable(pet)
		const current = settings()
		if (!window || current.passthrough || current.lockDrag || !Number.isFinite(dx) || !Number.isFinite(dy)) return
		const [x, y] = window.getPosition()
		const next = { x: Math.round(x + dx), y: Math.round(y + dy) }
		window.setPosition(next.x, next.y)
		current.petPosition = next
		options.onPetMoved()
	}

	function applySkipTaskbar() {
		const window = usable(pet)
		if (!window) return
		if (process.platform !== "linux") {
			window.setSkipTaskbar(true)
			return
		}
		updateKdeWindowRule(settings().alwaysOnTop)
		skipTaskbarOnX11(window)
	}

	function keepPetOnTop() {
		const window = usable(pet)
		if (!window || !window.isVisible() || !settings().alwaysOnTop) return
		window.setAlwaysOnTop(true, "screen-saver", 1)
		if (HAS_WORKSPACES) window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
		applySkipTaskbar()
		window.moveTop()
	}

	/** Polled regularly: toggles click-through, and feeds the cursor position for hover-fade while it is on. */
	function updateMousePassthrough() {
		const window = usable(pet)
		if (!window) return

		const current = settings()
		const ignoreMouse = Boolean(current.passthrough)
		if (ignoreMouse !== lastIgnoreMouseEvents) {
			window.setIgnoreMouseEvents(ignoreMouse, { forward: true })
			lastIgnoreMouseEvents = ignoreMouse
		}

		updateHoverFade(window, ignoreMouse && current.hoverFade)
	}

	/**
	 * Click-through windows receive no hover events, so hover-fade needs the cursor from elsewhere.
	 * KDE Wayland: KWin fades the window itself (XWayland's cursor position is stale there).
	 * Elsewhere: the renderer is sent the cursor position and fades its content.
	 */
	function updateHoverFade(window: BrowserWindow, active: boolean) {
		if (kwinHoverFade.available) {
			kwinHoverFade.update(active, hoverArea)
			return
		}
		if (active) {
			const bounds = window.getContentBounds()
			const cursor = screen.getCursorScreenPoint()
			const message: CursorMessage = { x: cursor.x - bounds.x, y: cursor.y - bounds.y }
			window.webContents.send("cursor", message)
			trackingCursor = true
		} else if (trackingCursor) {
			window.webContents.send("cursor", null)
			trackingCursor = false
		}
	}

	function setHoverArea(area: HoverArea) {
		const valid = [area?.left, area?.top, area?.right, area?.bottom].every(
			value => Number.isFinite(value) && value >= 0 && value <= 1,
		)
		if (valid) hoverArea = { left: area.left, top: area.top, right: area.right, bottom: area.bottom }
	}

	/** Re-applies every window-level setting and refreshes the tray menu's checkboxes. */
	function applySettings() {
		const window = usable(pet)
		if (!window) return
		const { alwaysOnTop } = settings()
		updateKdeWindowRule(alwaysOnTop)
		window.setAlwaysOnTop(alwaysOnTop, alwaysOnTop ? "screen-saver" : "normal", 1)
		if (HAS_WORKSPACES) window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
		if (alwaysOnTop) keepPetOnTop()
		updateMousePassthrough()
		options.getTray()?.setContextMenu(options.createTrayMenu())
	}

	/* --------------------------------- studio -------------------------------- */

	/** Clamps studio bounds to the minimum size and keeps the window on its display. */
	function fitStudio(bounds: Rectangle): Rectangle {
		const area = screen.getDisplayMatching(bounds).workArea
		const width = Math.round(
			Math.max(Math.min(STUDIO_MIN_SIZE.width, area.width), Math.min(bounds.width, area.width)),
		)
		const height = Math.round(
			Math.max(Math.min(STUDIO_MIN_SIZE.height, area.height), Math.min(bounds.height, area.height)),
		)
		return {
			x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - width))),
			y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))),
			width,
			height,
		}
	}

	/** Handles the studio's own title-bar buttons: minimize, maximize/restore, smaller, larger. */
	function resizeStudio(action: string) {
		const window = usable(studio)
		if (!window) return
		const bounds = window.getBounds()

		switch (action) {
			case "minimize":
				window.minimize()
				break
			case "maximize":
				if (studioRestoreBounds) {
					window.setBounds(fitStudio(studioRestoreBounds))
					studioRestoreBounds = null
				} else {
					studioRestoreBounds = bounds
					window.setBounds(screen.getDisplayMatching(bounds).workArea)
				}
				break
			case "smaller":
			case "larger": {
				const factor = action === "larger" ? STUDIO_ZOOM_STEP : 1 / STUDIO_ZOOM_STEP
				studioRestoreBounds = null
				window.setBounds(fitStudio({ ...bounds, width: bounds.width * factor, height: bounds.height * factor }))
				break
			}
		}
	}

	/** Resizes the frameless studio from one of its edge handles. Only the studio itself may ask. */
	function resizeStudioEdge(sender: Electron.WebContents, edge: ResizeEdge, dx: number, dy: number) {
		const window = usable(studio)
		if (!window || sender !== window.webContents || !RESIZE_EDGES.includes(edge)) return
		if (!Number.isFinite(dx) || !Number.isFinite(dy)) return

		studioRestoreBounds = null
		const bounds = window.getBounds()
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
		window.setBounds(fitStudio(bounds))
	}

	/** Shows the studio, creating it on first use. Closing only hides it until the app quits. */
	function showStudio() {
		const existing = usable(studio)
		if (existing) {
			if (existing.isMinimized()) existing.restore()
			existing.setBounds(fitStudio(existing.getBounds()))
			existing.show()
			existing.focus()
			return
		}

		const area = screen.getPrimaryDisplay().workArea
		const window = new BrowserWindow({
			width: Math.min(STUDIO_SIZE.width, area.width - 50),
			height: Math.min(STUDIO_SIZE.height, area.height - 50),
			minWidth: Math.min(STUDIO_MIN_SIZE.width, area.width),
			minHeight: Math.min(STUDIO_MIN_SIZE.height, area.height),
			resizable: true,
			maximizable: true,
			minimizable: true,
			frame: false,
			transparent: true,
			show: false,
			title: "Wuwa Tappo · Studio & Collection",
			icon: options.iconPath,
			backgroundColor: "#00000000",
			autoHideMenuBar: true,
			webPreferences: webPreferences(),
		})
		studio = window
		options.onWindowCreated(window)
		secureWindow(window)
		window.loadFile(options.studioPagePath)
		window.webContents.once("did-finish-load", () =>
			setTimeout(() => {
				window.show()
				window.focus()
			}, STUDIO_SHOW_DELAY_MS),
		)
		window.on("focus", () => setTimeout(keepPetOnTop, 0))
		window.on("close", event => {
			if (options.isQuitting()) return
			event.preventDefault()
			window.hide()
		})
	}

	return {
		get pet() {
			return usable(pet)
		},
		get studio() {
			return usable(studio)
		},
		/** Every live window, for broadcasting state. */
		windows: (): BrowserWindow[] => [usable(pet), usable(studio)].filter(window => window !== null),
		createPet,
		placePet,
		movePet,
		applySettings,
		keepPetOnTop,
		updateMousePassthrough,
		setHoverArea,
		/** Removes the KWin helper script; it would otherwise outlive the app. */
		dispose: () => kwinHoverFade.dispose(),
		resizeStudio,
		resizeStudioEdge,
		showStudio,
	}
}
