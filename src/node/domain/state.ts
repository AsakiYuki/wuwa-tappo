import type { CatalogItem, CollectionState, RawCollection, Settings } from "../types.js"
import { DEFAULTS } from "./constants.js"

function initial(items: CatalogItem[]): CollectionState {
	const starters = items.filter(x => x.starter)
	return {
		version: 2,
		owned: Object.fromEntries(starters.map(x => [x.id, 1])),
		favorites: [],
		presets: [],
		character: starters.find(x => x.type === "character" && x.roleId === 1502)?.id ?? "",
		accessory: starters.find(x => x.type === "accessory")?.id || "",
		emotes: starters
			.filter(x => x.type === "emote")
			.slice(0, 5)
			.map(x => x.id),
		count: 0,
		draws: 0,
		pity: 0,
		history: [],
		settings: { ...DEFAULTS },
	}
}
function normalize(raw: RawCollection | null | undefined, items: CatalogItem[]): CollectionState {
	const s = initial(items),
		valid = new Set(items.map(x => x.id))
	if (!raw || ![1, 2].includes(raw.version)) return s
	for (const [id, n] of Object.entries(raw.owned || {}))
		if (valid.has(id) && Number.isSafeInteger(n) && n > 0) s.owned[id] = Math.min(n, 1e9)
	for (const k of ["count", "draws", "pity"]) if (Number.isSafeInteger(raw[k]) && raw[k] >= 0) s[k] = raw[k]
	const hasType = (id, type) => s.owned[id] > 0 && items.some(x => x.id === id && x.type === type)
	if (hasType(raw.character, "character")) s.character = raw.character
	if (raw.accessory === "" || hasType(raw.accessory, "accessory")) s.accessory = raw.accessory
	if (Array.isArray(raw.emotes)) s.emotes = [...new Set(raw.emotes.filter(x => hasType(x, "emote")))].slice(0, 5)
	if (raw.version === 1 && s.emotes.length < 5) {
		for (const it of items.filter(x => x.starter && x.type === "emote")) {
			if (s.emotes.length >= 5) break
			if (!s.emotes.includes(it.id)) s.emotes.push(it.id)
		}
	}
	s.favorites = Array.isArray(raw.favorites) ? [...new Set(raw.favorites.filter(x => valid.has(x)))] : []
	s.presets = Array.isArray(raw.presets)
		? raw.presets.filter(x => x && hasType(x.character, "character")).slice(0, 12)
		: []
	s.history = Array.isArray(raw.history) ? raw.history.filter(x => valid.has(x.id)).slice(0, 100) : []
	const hasCounterLimit = Object.hasOwn(raw.settings || {}, "counterLimit")
	s.settings = settings({ ...s.settings, ...raw.settings })
	if (!hasCounterLimit) s.count %= 1000
	if (s.settings.counterLimit !== null) s.count = Math.min(s.count, s.settings.counterLimit)
	return s
}
function settings(s: Partial<Settings>): Settings {
	const out = { ...DEFAULTS }
	for (const k of [
		"alwaysOnTop",
		"passthrough",
		"inputEnabled",
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
	])
		if (typeof s[k] === "boolean") out[k] = s[k]
	out.scale = Math.max(0.65, Math.min(1.5, Number(s.scale) || 1))
	out.opacity = Math.max(0.3, Math.min(1, Number(s.opacity) || 1))
	out.counterLimit =
		s.counterLimit === null
			? null
			: Number.isSafeInteger(s.counterLimit)
				? Math.max(1, s.counterLimit)
				: DEFAULTS.counterLimit
	out.bubbleLifetime = Number.isFinite(s.bubbleLifetime)
		? Math.max(0.5, Math.min(3, s.bubbleLifetime))
		: DEFAULTS.bubbleLifetime
	out.controllerStyle = s.controllerStyle === "ps" || s.controllerStyle === "xbox"
		? s.controllerStyle
		: DEFAULTS.controllerStyle
	out.handAnimation = ["adaptive", "alternate", "random", "right", "left"].includes(s.handAnimation)
		? s.handAnimation
		: DEFAULTS.handAnimation
	const candidateLabels = s.keyLabels && typeof s.keyLabels === "object" ? s.keyLabels : {}
	out.keyLabels = { ...DEFAULTS.keyLabels }
	for (const [key, value] of Object.entries(candidateLabels)) {
		if (typeof value === "string" && value.trim()) out.keyLabels[key] = value.trim()
	}
	out.monitor = Number.isInteger(s.monitor) ? Math.max(0, s.monitor) : 0
	if (s.petPosition && typeof s.petPosition.x === "number" && typeof s.petPosition.y === "number")
		out.petPosition = {
			x: Math.round(s.petPosition.x),
			y: Math.round(s.petPosition.y),
		}
	return out
}
export { initial, normalize, settings }
