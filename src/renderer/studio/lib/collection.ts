import type { CatalogItem, CollectionState, ItemType, Rarity, SynthesisMode } from "../../shared/types"
import { RARITIES } from "./constants"

export type StudioPage =
	"collection" | "atlas" | "draw" | "synthesis" | "presets" | "settings" | "keyboard-labels" | "online"
export type InventoryType = "all" | ItemType
export type FilterKey = "series" | "role" | "rarity"
export type InventoryFilters = Record<FilterKey, string>

export interface SynthesisGroup {
	key: string
	type: ItemType
	rarity: Rarity
	/** Spare copies (every copy beyond the first) available as material. */
	count: number
	candidates: CatalogItem[]
}

const ITEM_TYPES: ItemType[] = ["character", "accessory", "emote"]

export const emptyFilters = (): InventoryFilters => ({ series: "all", role: "all", rarity: "all" })

export const spareCopies = (state: CollectionState, item: CatalogItem) => Math.max(0, (state.owned[item.id] ?? 0) - 1)

export function isEquipped(state: CollectionState, item: CatalogItem): boolean {
	if (item.type === "character") return state.character === item.id
	if (item.type === "accessory") return state.accessory === item.id
	return state.emotes.includes(item.id)
}

export function filterCollection(
	items: CatalogItem[],
	state: CollectionState,
	page: StudioPage,
	type: InventoryType,
	filters: InventoryFilters,
): CatalogItem[] {
	return items.filter(
		item =>
			(type === "all" || item.type === type) &&
			(page === "atlas" || state.owned[item.id] > 0) &&
			(filters.series === "all" || item.code === filters.series) &&
			(filters.role === "all" || String(item.roleId) === filters.role) &&
			(filters.rarity === "all" || item.rarity === filters.rarity),
	)
}

/** Owned first, then favorites, then (on the "Recent" tab) most recently obtained, then rarity and catalog order. */
export function sortCollection(
	items: CatalogItem[],
	state: CollectionState,
	page: StudioPage,
	type: InventoryType,
): CatalogItem[] {
	const recentOrder = new Map(state.history.map((entry, index) => [entry.id, state.history.length - index]))
	const sortByRecent = page === "collection" && type === "all"
	const favorites = new Set(state.favorites)

	return [...items].sort(
		(left, right) =>
			Number(Boolean(state.owned[right.id])) - Number(Boolean(state.owned[left.id])) ||
			Number(favorites.has(right.id)) - Number(favorites.has(left.id)) ||
			(sortByRecent ? (recentOrder.get(right.id) ?? 0) - (recentOrder.get(left.id) ?? 0) : 0) ||
			RARITIES.indexOf(right.rarity) - RARITIES.indexOf(left.rarity) ||
			left.assetId - right.assetId,
	)
}

export function getSynthesisGroups(
	items: CatalogItem[],
	state: CollectionState,
	mode: SynthesisMode,
): SynthesisGroup[] {
	return ITEM_TYPES.flatMap(type =>
		RARITIES.flatMap((rarity, index) => {
			const targetRarity = mode === "same" ? rarity : RARITIES[index + 1]
			if (!targetRarity) return []

			const candidates = items.filter(item => item.type === type && item.rarity === rarity)
			if (!candidates.length) return []

			const count = candidates.reduce((total, item) => total + spareCopies(state, item), 0)
			return [{ key: `${type}:${rarity}`, type, rarity, count, candidates }]
		}),
	)
}

/** The concrete copies a synthesis would consume, used to fill the material slots. */
export function pickSynthesisMaterials(group: SynthesisGroup, state: CollectionState, cost: number): CatalogItem[] {
	const materials: CatalogItem[] = []
	for (const item of group.candidates) {
		const count = Math.min(cost - materials.length, spareCopies(state, item))
		for (let index = 0; index < count; index++) materials.push(item)
		if (materials.length >= cost) break
	}
	return materials
}
