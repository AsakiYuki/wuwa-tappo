import type { CatalogItem, PetState } from "../types"
import { labels } from "./constants"

export type InventoryType = "all" | CatalogItem["type"]
export type InventoryPage = "collection" | "atlas" | "draw" | "synthesis" | "presets" | "settings" | "keyboard-labels"
export type InventoryFilters = Record<"series" | "role" | "rarity", string>
export type SynthesisMode = "same" | "upgrade"

export interface SynthesisGroup {
	type: CatalogItem["type"]
	rarity: CatalogItem["rarity"]
	count: number
	candidates: CatalogItem[]
}

export function filterCollection(
	items: CatalogItem[],
	state: PetState,
	page: InventoryPage,
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

export function sortCollection(
	items: CatalogItem[],
	state: PetState,
	page: InventoryPage,
	type: InventoryType,
): CatalogItem[] {
	const recentOrder = new Map(state.history.map((entry, index) => [entry.id, state.history.length - index]))
	const rarityOrder = Object.keys(labels)

	return [...items].sort(
		(left, right) =>
			Number(Boolean(state.owned[right.id])) - Number(Boolean(state.owned[left.id])) ||
			Number(state.favorites.includes(right.id)) - Number(state.favorites.includes(left.id)) ||
			(page === "collection" && type === "all"
				? (recentOrder.get(right.id) ?? 0) - (recentOrder.get(left.id) ?? 0)
				: 0) ||
			rarityOrder.indexOf(right.rarity) - rarityOrder.indexOf(left.rarity) ||
			left.assetId - right.assetId,
	)
}

export function getSynthesisGroups(items: CatalogItem[], state: PetState, mode: SynthesisMode): SynthesisGroup[] {
	const types: CatalogItem["type"][] = ["character", "accessory", "emote"]
	const rarities = Object.keys(labels) as CatalogItem["rarity"][]

	return types.flatMap(type =>
		rarities.flatMap((rarity, index) => {
			const targetRarity = mode === "same" ? rarity : rarities[index + 1]
			if (!targetRarity) return []

			const candidates = items.filter(item => item.type === type && item.rarity === rarity)
			if (!candidates.length) return []

			return [
				{
					type,
					rarity,
					count: candidates.reduce((total, item) => total + Math.max(0, (state.owned[item.id] ?? 0) - 1), 0),
					candidates,
				},
			]
		}),
	)
}
