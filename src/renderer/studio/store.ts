import { computed, ref, shallowRef } from "vue"
import { itemName } from "../shared/assets"
import type {
	CatalogFilters,
	CatalogItem,
	CollectionState,
	CommandResult,
	HistoryEntry,
	Settings,
} from "../shared/types"
import {
	emptyFilters,
	filterCollection,
	isEquipped,
	sortCollection,
	type InventoryFilters,
	type InventoryType,
	type StudioPage,
} from "./lib/collection"
import { toast } from "./toast"

export const MAX_EMOTES = 5

export interface ResultsPayload {
	results: Array<Pick<HistoryEntry, "id" | "fresh">>
	source: HistoryEntry["source"]
}

const api = window.petAPI

/* ------------------------------ app data ------------------------------ */

// Catalog and state are replaced wholesale on every broadcast, so shallow refs avoid deep proxies over 899 items.
export const state = shallowRef<CollectionState | null>(null)
export const items = shallowRef<CatalogItem[]>([])
export const filterMetadata = shallowRef<CatalogFilters>({ series: {}, roles: {} })
export const monitorCount = ref(1)
export const hookStatus = ref("")
export const itemMap = computed(() => new Map(items.value.map(item => [item.id, item])))
export const getItem = (id: string | undefined) => (id ? itemMap.value.get(id) : undefined)

/* ------------------------------- UI state ------------------------------ */

export const page = ref<StudioPage>("collection")
export const inventoryType = ref<InventoryType>("all")
export const inventoryFilters = ref<InventoryFilters>(emptyFilters())
/** Emote slot being replaced from the inventory, or null. */
export const replaceSlot = ref<number | null>(null)
/** The emote waiting for the user to choose which slot it replaces. */
export const emotePickerItem = shallowRef<CatalogItem | null>(null)
export const results = shallowRef<ResultsPayload | null>(null)
/** Bumped whenever the inventory should scroll back to the top. */
export const inventoryScrollReset = ref(0)

export const isAtlas = computed(() => page.value === "atlas")

export type KeyLabelMode = "ui" | "json"
export const keyLabelMode = ref<KeyLabelMode>("ui")

export const inventoryItems = computed(() => {
	if (!state.value) return []
	return sortCollection(
		filterCollection(items.value, state.value, page.value, inventoryType.value, inventoryFilters.value),
		state.value,
		page.value,
		inventoryType.value,
	)
})

/* ------------------------------- actions ------------------------------- */

/** Runs a main-process command and surfaces its error or warning as a toast. */
export async function command<T = unknown>(name: string, argument?: unknown): Promise<CommandResult<T>> {
	const result = await api.command<T>(name, argument)
	if (!result.ok && result.error) toast(result.error)
	if (result.warning) toast(result.warning)
	return result
}

export function setInventoryType(type: InventoryType) {
	inventoryType.value = type
	inventoryFilters.value = emptyFilters()
	inventoryScrollReset.value++
}

export function setInventoryFilter(key: keyof InventoryFilters, value: string) {
	inventoryFilters.value = { ...inventoryFilters.value, [key]: value }
	inventoryScrollReset.value++
}

/** Pages that only exist offline (local draws and synthesis). */
const OFFLINE_PAGES: StudioPage[] = ["draw", "synthesis"]

export function navigate(next: StudioPage) {
	if (state.value?.settings.onlineMode && OFFLINE_PAGES.includes(next)) next = "online"
	replaceSlot.value = null
	page.value = next
	setInventoryType("all")
}

export function equipped(item: CatalogItem) {
	return state.value ? isEquipped(state.value, item) : false
}

/** Opens the inventory filtered to emotes so the user can pick a replacement for `slot`. */
export function chooseEmoteSlot(slot: number) {
	navigate("collection")
	replaceSlot.value = Math.min(slot, state.value.emotes.length)
	setInventoryType("emote")
}

export function cancelReplace() {
	replaceSlot.value = null
}

export async function replaceEmote(item: CatalogItem, slot: number) {
	const result = await command("emote-replace", { id: item.id, slot })
	return result.ok
}

/** Click on an inventory card: equip it, or route emotes through slot replacement. */
export async function selectItem(item: CatalogItem) {
	const name = itemName(item)
	if (!state.value.owned[item.id]) {
		toast("Obtain via chests or synthesis")
		return
	}
	if (item.type === "emote" && replaceSlot.value !== null) {
		const slot = replaceSlot.value
		if (await replaceEmote(item, slot)) {
			replaceSlot.value = null
			toast(`Emote ${slot + 1} replaced with ${name}`)
		}
		return
	}
	if (item.type === "character" && equipped(item)) {
		toast(`${name} is already equipped`)
		return
	}
	if (item.type === "emote" && !equipped(item) && state.value.emotes.length >= MAX_EMOTES) {
		emotePickerItem.value = item
		return
	}
	const result = await command("equip", item.id)
	if (result.ok && item.type === "character") toast(`Equipped ${name}`)
}

export function updateSettings(patch: Partial<Settings>) {
	return command("settings", patch)
}

export function playEmote(id: string) {
	void command("emote", id)
}

export function showResults(payload: ResultsPayload) {
	results.value = payload
}

/* -------------------------------- draws -------------------------------- */

export const drawing = ref(false)
export const lastDrawCount = ref<1 | 10>(10)

export async function draw(count: 1 | 10) {
	if (drawing.value) return
	drawing.value = true
	lastDrawCount.value = count
	try {
		const response = await command<HistoryEntry[]>("draw", count)
		if (response.ok) showResults({ results: response.result, source: "draw" })
	} finally {
		drawing.value = false
	}
}

/* -------------------------------- wiring ------------------------------- */

export function connectStudio() {
	api.onState(next => {
		state.value = next
		if (page.value === "online" && !next.settings.onlineMode) navigate("settings")
		if (next.settings.onlineMode && OFFLINE_PAGES.includes(page.value)) navigate("online")
	})
	api.onStatus(status => {
		hookStatus.value = status.hook
		if (status.warning) toast(status.warning)
	})
	api.onPage(next => navigate(next as StudioPage))
	void api.init().then(payload => {
		items.value = payload.items
		filterMetadata.value = payload.filters
		monitorCount.value = payload.monitors.length
		hookStatus.value = payload.status.hook
		state.value = payload.state
		if (payload.status.warning) toast(payload.status.warning)
	})
}
