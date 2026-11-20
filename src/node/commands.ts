import type { App, BrowserWindow, Dialog, Shell } from "electron"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import type { CatalogItem, CollectionState, CommandResult, HandSide, Settings } from "./types.js"
import * as core from "./core.js"
import * as storage from "./storage.js"
import { setAutoStart } from "./autostart.js"
import { STATE_COMMANDS, canPlayEmote, importedState, patchSettings } from "./domain/commands.js"

export interface CommandContext {
	app: App
	dialog: Dialog
	shell: Shell
	dataDirectory: string
	items: CatalogItem[]
	getState(): CollectionState
	setState(state: CollectionState): void
	getPet(): BrowserWindow | null
	getStudio(): BrowserWindow | null
	showStudio(): void
	resizeStudio(action: string): void
	applySettings(): void
	placePet(resetToCorner?: boolean): void
	save(): Promise<boolean>
	broadcast(): void
	clearPressedKeys(): void
	input(key: string, down: boolean, side?: HandSide): void
	isInputHookConnected(): boolean
	saveWarning(): string
}

type Handler = (argument: any, context: CommandContext) => unknown

const JSON_FILTER = [{ name: "JSON", extensions: ["json"] }]
/** Delay before navigating a studio window that is still loading its page. */
const NAVIGATE_AFTER_LOAD_MS = 300
/** Reloading the pet resets its size; re-place it once the new page has laid out. */
const PLACE_AFTER_RELOAD_MS = 150

/* ------------------------------------------------------------------------- */
/* Commands that only act on windows or the OS. They never change the state. */
/* ------------------------------------------------------------------------- */

const actionCommands: Record<string, Handler> = {
	open(page: string | undefined, context) {
		context.showStudio()
		const studio = context.getStudio()
		if (!page || !studio) return
		const navigate = () => studio.webContents.send("page", page)
		if (studio.webContents.isLoading())
			studio.webContents.once("did-finish-load", () => setTimeout(navigate, NAVIGATE_AFTER_LOAD_MS))
		else navigate()
	},

	hide: (_argument, context) => context.getStudio()?.hide(),

	window: (action: string, context) => context.resizeStudio(action),

	emote(id: string, context) {
		if (!canPlayEmote(context.getState(), context.items, id)) throw new Error("Emote not owned")
		context.getPet()?.webContents.send("emote", id)
	},

	async recenter(_argument, context) {
		context.placePet(true)
		await context.save()
		context.getPet()?.show()
	},

	/** Clicking the pet counts as a tap only when no global hook already reported the click. */
	tap(_argument, context) {
		if (context.isInputHookConnected()) return
		context.input("MouseLeft", true, "left")
		context.input("MouseLeft", false)
	},

	folder: async (_argument, context) => void (await context.shell.openPath(context.dataDirectory)),

	quit: (_argument, context) => context.app.quit(),

	async "export-data"(_argument, context) {
		const { canceled, filePath } = await context.dialog.showSaveDialog({
			title: "Export Wuwa Tappo Data",
			defaultPath: path.join(context.app.getPath("downloads"), "wuwa-tappo-data.json"),
			filters: JSON_FILTER,
		})
		if (canceled || !filePath) return "cancelled"
		await writeFile(filePath, JSON.stringify(context.getState(), null, 2), "utf8")
		return "exported"
	},
}

/* ------------------------------------------------------------------------- */
/* Commands that change the collection. Afterwards the state is saved and     */
/* broadcast to every window.                                                 */
/* ------------------------------------------------------------------------- */

const stateCommands: Record<string, Handler> = {
	// Pure collection commands, shared with the Tauri port.
	...Object.fromEntries(
		Object.entries(STATE_COMMANDS).map(([name, run]): [string, Handler] => [
			name,
			(argument, context) => run(context.getState(), context.items, argument),
		]),
	),

	settings: (patch: Partial<Settings>, context) => updateSettings(patch, context),

	async "import-data"(_argument, context) {
		const { canceled, filePaths } = await context.dialog.showOpenDialog({
			title: "Import Wuwa Tappo Data",
			properties: ["openFile"],
			filters: JSON_FILTER,
		})
		if (canceled || !filePaths.length) return "cancelled"
		const saved = storage.readSave(filePaths[0])
		if (!saved) throw new Error("This file is not a valid Wuwa Tappo save")
		replaceState(importedState(saved.raw, context.items, context.getState()), context)
		context.placePet()
		return "imported"
	},

	"reset-data"(_argument, context) {
		replaceState(core.initial(context.items), context)
		context.placePet(true)
	},
}

/** Swaps in a whole new state and re-applies everything that depends on settings. */
function replaceState(state: CollectionState, context: CommandContext) {
	context.setState(state)
	context.clearPressedKeys()
	setAutoStart(state.settings.autoStart, context.app)
	context.applySettings()
}

function updateSettings(patch: Partial<Settings>, context: CommandContext) {
	const state = context.getState()
	context.clearPressedKeys()

	const wanted = core.settings({ ...state.settings, ...patch })
	if (wanted.autoStart !== state.settings.autoStart) {
		if (wanted.autoStart && !context.app.isPackaged && process.platform !== "linux")
			throw new Error("Please enable auto-start from packaged build")
		setAutoStart(wanted.autoStart, context.app)
	}

	const previous = patchSettings(state, patch)
	const next = state.settings
	context.applySettings()

	if (next.showKeyboard !== previous.showKeyboard) reloadPet(context)
	if (next.scale !== previous.scale || next.monitor !== previous.monitor) context.placePet()
}

/** The pet's window size depends on whether the keyboard is shown, so it is reloaded and re-placed. */
function reloadPet(context: CommandContext) {
	const pet = context.getPet()
	if (!pet || pet.isDestroyed()) return
	pet.reload()
	setTimeout(() => context.placePet(), PLACE_AFTER_RELOAD_MS)
}

export async function executeCommand(name: string, argument: unknown, context: CommandContext): Promise<CommandResult> {
	try {
		if (Object.hasOwn(actionCommands, name)) {
			const result = await actionCommands[name](argument, context)
			return { ok: true, result }
		}
		if (!Object.hasOwn(stateCommands, name)) throw new Error("Unknown command")

		const result = (await stateCommands[name](argument, context)) ?? null
		if (result === "cancelled") return { ok: true, result }
		const saved = await context.save()
		context.broadcast()
		return { ok: true, result, warning: saved ? "" : context.saveWarning() }
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) }
	}
}
