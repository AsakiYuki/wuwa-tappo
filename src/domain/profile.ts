import type { CatalogItem, CollectionState, RawCollection } from "./types.js"
import { initial, normalize } from "./state.js"

/*
 * Online mode has a collection of its own. The offline one (everything unlocked, local draws) is never
 * read or written while online mode is on, and what the account owns on the server never lands in it.
 * Settings are the one thing both share. The offline state is the save file's top level; the online
 * profile is stored inside it under `online`.
 */

/** What the save file keeps of the online profile: everything but the shared settings. */
export type OnlineProfileSave = Omit<CollectionState, "settings">

/** The online profile of a save's text, or a fresh one (starter items only) if the save has none. */
export function loadOnlineProfile(raw: unknown, items: CatalogItem[]): CollectionState {
	const saved = (raw as { online?: unknown } | null)?.online
	if (!saved || typeof saved !== "object") return initial(items)
	// `normalize` drops everything unknown or not owned; the settings it fills in are replaced by the shared ones.
	return normalize({ ...(saved as object), version: 2 } as RawCollection, items)
}

/** The save's text for both profiles: the offline state, with the online profile inside it. */
export function saveBoth(offline: CollectionState, online: CollectionState): string {
	const { settings: _shared, ...profile } = online
	return JSON.stringify({ ...offline, online: profile satisfies OnlineProfileSave }, null, 2)
}

/** Points the online profile at the offline state's settings object, the one that is saved. */
export function shareSettings(offline: CollectionState, online: CollectionState) {
	online.settings = offline.settings
}

/** An account's bag entry: a catalog asset id and how many the account has. */
export interface BagEntry {
	assetId: number
	count: number
}

/**
 * Makes the online profile own what the server's bag lists (plus the starter items, which are free).
 * Anything equipped that is no longer owned falls back to the starter outfit.
 */
export function applyBag(state: CollectionState, items: CatalogItem[], entries: BagEntry[]) {
	if (!state.settings.onlineMode) throw new Error("The bag only applies in online mode")
	const byAsset = new Map<string, CatalogItem[]>()
	for (const item of items) {
		const key = `${item.type}:${item.assetId}`
		byAsset.set(key, [...(byAsset.get(key) ?? []), item])
	}
	const base = initial(items)
	const owned: Record<string, number> = { ...base.owned }
	for (const entry of entries) {
		if (!Number.isSafeInteger(entry.assetId) || entry.assetId <= 0) continue
		const count = Number.isSafeInteger(entry.count) && entry.count > 0 ? Math.min(entry.count, 1e9) : 1
		for (const type of ["character", "accessory", "emote"]) {
			for (const item of byAsset.get(`${type}:${entry.assetId}`) ?? [])
				owned[item.id] = Math.max(owned[item.id] ?? 0, count)
		}
	}
	state.owned = owned
	const ownsOfType = (id: string, type: string) =>
		owned[id] > 0 && items.some(item => item.id === id && item.type === type)
	if (!ownsOfType(state.character, "character")) state.character = base.character
	if (state.accessory !== "" && !ownsOfType(state.accessory, "accessory")) state.accessory = ""
	state.emotes = state.emotes.filter(id => ownsOfType(id, "emote"))
	state.presets = state.presets.filter(preset => ownsOfType(preset.character, "character"))
	state.favorites = state.favorites.filter(id => owned[id] > 0)
}
