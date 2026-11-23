import type { CatalogItem, CollectionState, HistoryEntry, ItemType, Preset, RawCollection, Settings } from "../types.js"
import { DEFAULTS } from "./constants.js"

export const MAX_PRESETS = 12
export const MAX_PRESET_NAME = 24
export const DEFAULT_PRESET_NAME = "My Outfit"
const MAX_PRESET_ID = 32
const MAX_HISTORY = 100
const MAX_EMOTES = 5
const MAX_OWNED = 1e9
/** Rover (F) is equipped on a fresh install. */
const STARTER_CHARACTER_ROLE = 1502
/** Saves from before the configurable counter limit always wrapped at 1000. */
const LEGACY_COUNTER_WRAP = 1000
/** Bounds on custom key labels, so an imported save cannot bloat the profile. */
const MAX_KEY_LABELS = 256
const MAX_KEY_NAME = 64
const MAX_KEY_LABEL = 32
/** Bounds on the pet's screen index and saved position, so a save cannot place it absurdly far away. */
const MAX_MONITOR = 32
const MAX_POSITION = 100_000

/** Labels that older versions stored as defaults; they are dropped so the keyboard's own labels show. */
const LEGACY_DEFAULT_KEY_LABELS: Record<string, string> = {
	Meta: "Meta",
	Ctrl: "Ctrl",
	Alt: "Alt",
	Shift: "Shift",
	Tab: "Tab",
	CapsLock: "Caps",
	Backspace: "⌫",
	Enter: "↵",
	Space: "SPACE",
}

const BOOLEAN_SETTINGS = [
	"alwaysOnTop",
	"passthrough",
	"inputEnabled",
	"touchpadInput",
	"autoStart",
	"lockDrag",
	"hoverFade",
	"showChest",
	"showKeyboard",
	"autoEmote",
	"showPressedKeys",
	"showMouseBubbles",
	"counterLeft",
	"holdAnimation",
] as const satisfies ReadonlyArray<keyof Settings>

const COUNTERS = ["count", "totalCount", "draws", "pity"] as const

const HAND_ANIMATIONS: ReadonlyArray<Settings["handAnimation"]> = ["adaptive", "alternate", "random", "right", "left"]

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0

/** Today's date as `YYYY-MM-DD` in local time, used to reset the daily counter. */
export function localDateKey(date = new Date()): string {
	const month = String(date.getMonth() + 1).padStart(2, "0")
	const day = String(date.getDate()).padStart(2, "0")
	return `${date.getFullYear()}-${month}-${day}`
}

/** A fresh collection: only starter items, Rover (F) equipped, default settings. */
export function initial(items: CatalogItem[]): CollectionState {
	const starters = items.filter(item => item.starter)
	return {
		version: 2,
		owned: Object.fromEntries(starters.map(item => [item.id, 1])),
		favorites: [],
		presets: [],
		character: starters.find(item => item.type === "character" && item.roleId === STARTER_CHARACTER_ROLE)?.id ?? "",
		accessory: starters.find(item => item.type === "accessory")?.id || "",
		emotes: starters
			.filter(item => item.type === "emote")
			.slice(0, MAX_EMOTES)
			.map(item => item.id),
		count: 0,
		totalCount: 0,
		dailyCount: 0,
		dailyCountDate: localDateKey(),
		draws: 0,
		pity: 0,
		history: [],
		settings: { ...DEFAULTS },
	}
}

/** Turns an untrusted save (v1 or v2) into a valid state, dropping anything unknown or out of range. */
export function normalize(raw: RawCollection | null | undefined, items: CatalogItem[]): CollectionState {
	const state = initial(items)
	if (!raw || ![1, 2].includes(raw.version)) return state

	const validIds = new Set(items.map(item => item.id))
	const ownsItemOfType = (id: string, type: ItemType) =>
		state.owned[id] > 0 && items.some(item => item.id === id && item.type === type)

	for (const [id, count] of Object.entries(raw.owned || {}))
		if (validIds.has(id) && Number.isSafeInteger(count) && count > 0) state.owned[id] = Math.min(count, MAX_OWNED)

	for (const key of COUNTERS) if (isCount(raw[key])) state[key] = raw[key]
	if (!Object.hasOwn(raw, "totalCount")) state.totalCount = state.count
	if (isCount(raw.dailyCount)) state.dailyCount = raw.dailyCount
	if (typeof raw.dailyCountDate === "string") state.dailyCountDate = raw.dailyCountDate
	if (state.dailyCountDate !== localDateKey()) {
		state.dailyCount = 0
		state.dailyCountDate = localDateKey()
	}

	if (ownsItemOfType(raw.character, "character")) state.character = raw.character
	if (raw.accessory === "" || ownsItemOfType(raw.accessory, "accessory")) state.accessory = raw.accessory
	if (Array.isArray(raw.emotes))
		state.emotes = [...new Set(raw.emotes.filter(id => ownsItemOfType(id, "emote")))].slice(0, MAX_EMOTES)
	if (raw.version === 1) fillStarterEmotes(state, items)

	state.favorites = Array.isArray(raw.favorites) ? [...new Set(raw.favorites.filter(id => validIds.has(id)))] : []
	state.presets = normalizePresets(raw.presets, ownsItemOfType)
	state.history = normalizeHistory(raw.history, validIds)

	const hasCounterLimit = Object.hasOwn(raw.settings || {}, "counterLimit")
	state.settings = settings({ ...state.settings, ...raw.settings })
	if (!hasCounterLimit) state.count %= LEGACY_COUNTER_WRAP
	if (state.settings.counterLimit !== null) state.count = Math.min(state.count, state.settings.counterLimit)
	return state
}

/**
 * Rebuilds presets field by field. Every field is copied out of the save, so nothing unexpected
 * (huge strings, nested objects, wrong types) survives into the state, the save file or the pages.
 */
function normalizePresets(raw: unknown, ownsItemOfType: (id: string, type: ItemType) => boolean): Preset[] {
	if (!Array.isArray(raw)) return []
	const presets: Preset[] = []
	const ids = new Set<string>()
	for (const preset of raw) {
		if (presets.length >= MAX_PRESETS) break
		if (!preset || typeof preset !== "object" || !ownsItemOfType(preset.character, "character")) continue
		const savedId = typeof preset.id === "string" && preset.id.length <= MAX_PRESET_ID ? preset.id : ""
		const id = savedId && !ids.has(savedId) ? savedId : newPresetId(ids)
		ids.add(id)
		presets.push({
			id,
			name: presetName(preset.name),
			character: preset.character,
			accessory: ownsItemOfType(preset.accessory, "accessory") ? preset.accessory : "",
			emotes: Array.isArray(preset.emotes)
				? [...new Set<string>(preset.emotes.filter((id: string) => ownsItemOfType(id, "emote")))].slice(
						0,
						MAX_EMOTES,
					)
				: [],
		})
	}
	return presets
}

function normalizeHistory(raw: unknown, validIds: Set<string>): HistoryEntry[] {
	if (!Array.isArray(raw)) return []
	return raw
		.filter(entry => entry && typeof entry === "object" && validIds.has(entry.id))
		.slice(0, MAX_HISTORY)
		.map(entry => ({
			id: entry.id,
			fresh: entry.fresh === true,
			source: entry.source === "synthesis" ? "synthesis" : "draw",
			at: Number.isFinite(entry.at) ? entry.at : 0,
		}))
}

/** A preset's name: trimmed and bounded, or the default. */
export function presetName(name: unknown): string {
	return (typeof name === "string" ? name.trim().slice(0, MAX_PRESET_NAME) : "") || DEFAULT_PRESET_NAME
}

/** A preset id not in `taken`: the current time, with a suffix when several are made at once. */
export function newPresetId(taken: Iterable<string>): string {
	const ids = new Set(taken)
	const base = Date.now().toString(36)
	let id = base
	for (let suffix = 1; ids.has(id); suffix++) id = `${base}-${suffix}`
	return id
}

/** Version 1 saves had fewer emote slots; top them up with starter emotes. */
function fillStarterEmotes(state: CollectionState, items: CatalogItem[]) {
	for (const item of items) {
		if (state.emotes.length >= MAX_EMOTES) break
		if (item.starter && item.type === "emote" && !state.emotes.includes(item.id)) state.emotes.push(item.id)
	}
}

/** Validates a settings object field by field, falling back to defaults for anything invalid. */
export function settings(input: Partial<Settings>): Settings {
	const result: Settings = { ...DEFAULTS }

	for (const key of BOOLEAN_SETTINGS) if (typeof input[key] === "boolean") result[key] = input[key]

	result.scale = clamp(Number(input.scale) || 1, 0.65, 1.5)
	result.opacity = clamp(Number(input.opacity) || 1, 0.3, 1)
	result.monitor = Number.isInteger(input.monitor) ? clamp(input.monitor, 0, MAX_MONITOR) : 0
	result.counterFormat =
		typeof input.counterFormat === "string" ? input.counterFormat.slice(0, 128) : DEFAULTS.counterFormat
	result.counterLimit =
		input.counterLimit === null
			? null
			: Number.isSafeInteger(input.counterLimit)
				? Math.max(1, input.counterLimit)
				: DEFAULTS.counterLimit
	result.bubbleLifetime = Number.isFinite(input.bubbleLifetime)
		? clamp(input.bubbleLifetime, 0.5, 3)
		: DEFAULTS.bubbleLifetime
	result.bubbleColor =
		typeof input.bubbleColor === "string" && /^#[\da-f]{6}$/i.test(input.bubbleColor)
			? input.bubbleColor.toLowerCase()
			: DEFAULTS.bubbleColor
	result.controllerStyle =
		input.controllerStyle === "ps" || input.controllerStyle === "xbox"
			? input.controllerStyle
			: DEFAULTS.controllerStyle
	result.handAnimation = HAND_ANIMATIONS.includes(input.handAnimation) ? input.handAnimation : DEFAULTS.handAnimation
	result.keyLabels = normalizeKeyLabels(input.keyLabels)

	const position = input.petPosition
	if (position && Number.isFinite(position.x) && Number.isFinite(position.y))
		result.petPosition = {
			x: Math.round(clamp(position.x, -MAX_POSITION, MAX_POSITION)),
			y: Math.round(clamp(position.y, -MAX_POSITION, MAX_POSITION)),
		}
	return result
}

/** Custom labels are layered over the defaults; blank and legacy-default labels are ignored. */
function normalizeKeyLabels(input: unknown): Record<string, string> {
	const labels: Record<string, string> = { ...DEFAULTS.keyLabels }
	if (!input || typeof input !== "object") return labels
	let custom = 0
	for (const [key, value] of Object.entries(input)) {
		if (custom >= MAX_KEY_LABELS) break
		if (!key || key.length > MAX_KEY_NAME || key === "__proto__") continue
		const label = typeof value === "string" ? value.trim().slice(0, MAX_KEY_LABEL) : ""
		if (label && LEGACY_DEFAULT_KEY_LABELS[key] !== label) {
			labels[key] = label
			custom++
		}
	}
	return labels
}
