import type { CatalogItem, CollectionState, RawCollection, Settings } from "./types.js"
import { draw, equip, replaceEmote, synthesize } from "./actions.js"
import { MAX_PRESETS, newPresetId, normalize, presetName, settings } from "./state.js"

/*
 * Collection commands, run by the app through QuickJS (src/backend). They only touch the state;
 * windows, dialogs, files and saving are the Rust side's (src-tauri).
 */

type StateCommand = (state: CollectionState, items: CatalogItem[], argument: any) => unknown

/** Offline-only commands: the online account has its own chests, and nothing is unlocked or reset locally. */
export const OFFLINE_ONLY_COMMANDS = ["draw", "synthesize", "unlock-all", "import-data", "reset-data"] as const

export function assertOffline(state: CollectionState, name: string) {
	if (state.settings.onlineMode && (OFFLINE_ONLY_COMMANDS as readonly string[]).includes(name))
		throw new Error("Not available in online mode")
}

export const STATE_COMMANDS: Record<string, StateCommand> = {
	draw: (state, items, count: number) => draw(state, items, count),

	synthesize: (state, items, options) => synthesize(state, items, options.n, options.rarity, Math.random, options),

	equip: (state, items, id: string) => equip(state, items, id),

	"emote-replace": (state, items, { id, slot }) => replaceEmote(state, items, id, slot),

	favorite(state, items, id: string) {
		if (!items.some(item => item.id === id)) throw new Error("Item does not exist")
		state.favorites = state.favorites.includes(id)
			? state.favorites.filter(favorite => favorite !== id)
			: [...state.favorites, id]
	},

	"preset-save"(state, _items, name: unknown) {
		if (state.presets.length >= MAX_PRESETS) throw new Error("Maximum 12 presets allowed")
		state.presets.push({
			id: newPresetId(state.presets.map(preset => preset.id)),
			name: presetName(name),
			character: state.character,
			accessory: state.accessory,
			emotes: [...state.emotes],
		})
	},

	"preset-load"(state, _items, id: string) {
		const preset = state.presets.find(candidate => candidate.id === id)
		if (!preset) throw new Error("Preset does not exist")
		state.character = preset.character
		state.accessory = preset.accessory
		state.emotes = [...preset.emotes]
	},

	"preset-delete"(state, _items, id: string) {
		state.presets = state.presets.filter(preset => preset.id !== id)
	},

	"unlock-all"(state, items) {
		for (const item of items) state.owned[item.id] = Math.max(1, state.owned[item.id] || 0)
	},
}

/** Whether parsed JSON is a save this version understands (versions 1 and 2). */
export function isKnownSave(raw: unknown): raw is RawCollection {
	const save = raw as RawCollection | null
	return Boolean(save) && [1, 2].includes(save.version) && Boolean(save.owned) && typeof save.owned === "object"
}

/**
 * The state an imported save becomes. A save file must never register a login item or switch on
 * network access on its own, so the current auto-start and online-mode choices are kept.
 */
export function importedState(raw: unknown, items: CatalogItem[], current: CollectionState): CollectionState {
	if (!isKnownSave(raw)) throw new Error("This file is not a valid Wuwa Tappo save")
	const state = normalize(raw, items)
	state.settings.autoStart = current.settings.autoStart
	state.settings.onlineMode = current.settings.onlineMode
	return state
}

/** Applies a settings patch; returns the previous settings so the app can react to what changed. */
export function patchSettings(state: CollectionState, patch: Partial<Settings>): Settings {
	const previous = state.settings
	const next = settings({ ...previous, ...patch })
	state.settings = next
	if (next.counterLimit !== null && state.count > next.counterLimit) state.count = next.counterLimit
	return previous
}

/** Whether `id` is an owned emote, i.e. may be played on the pet. */
export function canPlayEmote(state: CollectionState, items: CatalogItem[], id: string): boolean {
	return state.owned[id] > 0 && items.some(item => item.id === id && item.type === "emote")
}
