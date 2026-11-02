import type { App, BrowserWindow, Dialog, Shell } from "electron"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import type { CatalogItem, CollectionState } from "./types.js"
import * as core from "./core.js"
import * as storage from "./storage.js"
import { setAutoStart } from "./autostart.js"

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
	input(key: string, down: boolean, side?: "left" | "right"): void
	inputStatus: string
	saveWarning(): string
}

export async function executeCommand(name: string, argument: any, context: CommandContext) {
	const {
		app,
		dialog,
		shell,
		dataDirectory,
		items,
		getPet,
		getStudio,
		showStudio,
		resizeStudio,
		applySettings,
		placePet,
		save,
		broadcast,
		clearPressedKeys,
		input,
	} = context
	let state = context.getState()
	let result: unknown = null

	try {
		switch (name) {
			case "open": {
				showStudio()
				const studio = getStudio()
				if (argument && studio) {
					const navigate = () => setTimeout(() => studio.webContents.send("page", argument), 300)
					if (studio.webContents.isLoading()) studio.webContents.once("did-finish-load", navigate)
					else studio.webContents.send("page", argument)
				}
				return { ok: true }
			}
			case "hide":
				getStudio()?.hide()
				return { ok: true }
			case "draw":
				result = core.draw(state, items, argument)
				break
			case "synthesize":
				result = core.synthesize(state, items, argument.n, argument.rarity, Math.random, argument)
				break
			case "equip":
				core.equip(state, items, argument)
				break
			case "emote-replace":
				core.replaceEmote(state, items, argument.id, argument.slot)
				break
			case "window":
				resizeStudio(argument)
				return { ok: true }
			case "favorite":
				toggleFavorite(state, items, argument)
				break
			case "preset-save":
				savePreset(state, argument)
				break
			case "preset-load":
				loadPreset(state, argument)
				break
			case "preset-delete":
				state.presets = state.presets.filter(preset => preset.id !== argument)
				break
			case "emote":
				sendEmote(state, items, getPet(), argument)
				return { ok: true }
			case "unlock-all":
				for (const item of items) state.owned[item.id] = Math.max(1, state.owned[item.id] || 0)
				break
			case "export-data": {
				const { canceled, filePath } = await dialog.showSaveDialog({
					title: "Export Wuwa Tappo Data",
					defaultPath: path.join(app.getPath("downloads"), "wuwa-tappo-data.json"),
					filters: [{ name: "JSON", extensions: ["json"] }],
				})
				if (canceled || !filePath) return { ok: true, result: "cancelled" }
				await writeFile(filePath, JSON.stringify(state, null, 2), "utf8")
				return { ok: true, result: "exported" }
			}
			case "import-data": {
				const { canceled, filePaths } = await dialog.showOpenDialog({
					title: "Import Wuwa Tappo Data",
					properties: ["openFile"],
					filters: [{ name: "JSON", extensions: ["json"] }],
				})
				if (canceled || !filePaths.length) return { ok: true, result: "cancelled" }
				const saved = storage.readSave(filePaths[0])
				if (!saved) throw new Error("This file is not a valid Wuwa Tappo save")
				state = core.normalize(saved.raw, items)
				if (!app.isPackaged && state.settings.autoStart) state.settings.autoStart = false
				context.setState(state)
				clearPressedKeys()
				setAutoStart(state.settings.autoStart, app)
				applySettings()
				placePet()
				result = "imported"
				break
			}
			case "reset-data":
				state = core.initial(items)
				context.setState(state)
				clearPressedKeys()
				setAutoStart(false, app)
				applySettings()
				placePet(true)
				break
			case "settings":
				updateSettings(context, state, argument)
				break
			case "recenter":
				placePet(true)
				await save()
				getPet()?.show()
				return { ok: true }
			case "tap":
				if (!context.inputStatus.includes("connected")) {
					input("MouseLeft", true, "left")
					input("MouseLeft", false)
				}
				return { ok: true }
			case "folder":
				await shell.openPath(dataDirectory)
				return { ok: true }
			case "quit":
				app.quit()
				return { ok: true }
			default:
				throw new Error("Unknown command")
		}

		context.setState(state)
		const saved = await save()
		broadcast()
		return {
			ok: true,
			result,
			warning: saved ? "" : context.saveWarning(),
		}
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

function toggleFavorite(state: CollectionState, items: CatalogItem[], itemId: string) {
	if (!items.some(item => item.id === itemId)) throw new Error("Item does not exist")

	state.favorites = state.favorites.includes(itemId)
		? state.favorites.filter(id => id !== itemId)
		: [...state.favorites, itemId]
}

function savePreset(state: CollectionState, value: unknown) {
	if (state.presets.length >= 12) throw new Error("Maximum 12 presets allowed")

	state.presets.push({
		id: Date.now().toString(36),
		name: String(value || "My Outfit")
			.trim()
			.slice(0, 24),
		character: state.character,
		accessory: state.accessory,
		emotes: [...state.emotes],
	})
}

function loadPreset(state: CollectionState, presetId: string) {
	const preset = state.presets.find(item => item.id === presetId)
	if (!preset) throw new Error("Preset does not exist")

	state.character = preset.character
	state.accessory = preset.accessory
	state.emotes = [...preset.emotes]
}

function sendEmote(state: CollectionState, items: CatalogItem[], pet: BrowserWindow | null, itemId: string) {
	const owned = state.owned[itemId] > 0
	const isEmote = items.some(item => item.id === itemId && item.type === "emote")
	if (!owned || !isEmote) throw new Error("Emote not owned")
	pet?.webContents.send("emote", itemId)
}

function updateSettings(context: CommandContext, state: CollectionState, patch: unknown) {
	context.clearPressedKeys()
	const previous = state.settings
	const next = core.settings({ ...previous, ...(patch as object) })

	if (next.autoStart !== previous.autoStart) {
		if (!context.app.isPackaged && next.autoStart) throw new Error("Please enable auto-start from packaged build")

		setAutoStart(next.autoStart, context.app)
	}

	state.settings = next
	if (next.counterLimit !== null && state.count > next.counterLimit) state.count = next.counterLimit
	context.setState(state)
	context.applySettings()
	if (next.scale !== previous.scale || next.monitor !== previous.monitor) context.placePet()
}
