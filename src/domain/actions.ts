import type { CatalogItem, CollectionState, HistoryEntry, Rarity, SynthesisOptions } from "./types.js"
import { RARITIES } from "./constants.js"
import { localDateKey } from "./state.js"

type Random = () => number

const MAX_HISTORY = 100
const MAX_EMOTES = 5
/** A draw is forced to Epic once this many pulls pass without one. */
const EPIC_PITY = 50

/* -------------------------------- helpers -------------------------------- */

/** Rolls a rarity with 65 / 25 / 9 / 1 % odds, never below `minimumIndex`. */
function rollRarity(random: Random, minimumIndex = 0): Rarity {
	const roll = random()
	const index = roll < 0.65 ? 0 : roll < 0.9 ? 1 : roll < 0.99 ? 2 : 3
	return RARITIES[Math.max(index, minimumIndex)]
}

function pickRandom<T>(pool: T[], random: Random): T {
	if (!pool.length) throw Error("The item pool is empty")
	return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]
}

const spareCopies = (state: CollectionState, item: CatalogItem) => Math.max(0, (state.owned[item.id] || 0) - 1)

/** Adds one copy of `item` to the collection and records it in the history. */
function award(state: CollectionState, item: CatalogItem, source: HistoryEntry["source"]): HistoryEntry {
	const entry: HistoryEntry = { id: item.id, fresh: !state.owned[item.id], source, at: Date.now() }
	state.owned[item.id] = (state.owned[item.id] || 0) + 1
	state.history = [entry, ...state.history].slice(0, MAX_HISTORY)
	return entry
}

/* --------------------------------- draws --------------------------------- */

/** Opens 1 or 10 chests. A ten-pull guarantees at least one Uncommon; pity guarantees an Epic. */
function draw(state: CollectionState, items: CatalogItem[], count: number, random: Random = Math.random) {
	if (count !== 1 && count !== 10) throw Error("Choose a single draw or a ten-draw pull")

	const results: HistoryEntry[] = []
	let gotUncommonOrBetter = false
	for (let index = 0; index < count; index++) {
		state.pity++
		const isLastOfTen = count === 10 && index === 9
		let rarity = rollRarity(random, isLastOfTen && !gotUncommonOrBetter ? 1 : 0)
		if (state.pity >= EPIC_PITY) rarity = "epic"
		if (rarity === "epic") state.pity = 0
		if (rarity !== "common") gotUncommonOrBetter = true

		const pool = items.filter(item => item.rarity === rarity)
		results.push(award(state, pickRandom(pool, random), "draw"))
		state.draws++
	}
	return results
}

/* ------------------------------- synthesis ------------------------------- */

/**
 * Consumes spare copies of one type and rarity to create new items.
 * "same" turns 5 copies into one item of the same rarity, "upgrade" turns 10 into one of the next rarity.
 * Unowned targets are preferred. The state is only changed if every synthesis succeeds.
 */
function synthesize(
	state: CollectionState,
	items: CatalogItem[],
	count: number,
	rarity: Rarity,
	random: Random = Math.random,
	options: SynthesisOptions = {},
): HistoryEntry[] {
	const type = options.type || "character"
	const mode = options.mode || "upgrade"
	const cost = mode === "same" ? 5 : 10
	if (
		![1, 10].includes(count) ||
		!RARITIES.includes(rarity) ||
		!["character", "accessory", "emote"].includes(type) ||
		!["same", "upgrade"].includes(mode)
	)
		throw Error("Invalid synthesis options")
	if (mode === "upgrade" && rarity === "epic") throw Error("Epic is the highest rarity; choose same-tier synthesis")

	const materials = items.filter(item => item.rarity === rarity && item.type === type)
	const available = materials.reduce((total, item) => total + spareCopies(state, item), 0)
	if (available < cost * count)
		throw Error("Not enough duplicate items of this type and rarity; required: " + cost * count + " items")

	const targetRarity = mode === "same" ? rarity : RARITIES[RARITIES.indexOf(rarity) + 1]
	const targets = items.filter(item => item.rarity === targetRarity && item.type === type)
	if (!targets.length) throw Error("No target-rarity items exist for this type")

	const draft = structuredClone(state)
	const results: HistoryEntry[] = []
	for (let index = 0; index < count; index++) {
		let remaining = cost
		for (const item of materials) {
			const taken = Math.min(remaining, spareCopies(draft, item))
			if (taken > 0) draft.owned[item.id] -= taken
			remaining -= taken
			if (!remaining) break
		}
		const unowned = targets.filter(item => !draft.owned[item.id])
		results.push(award(draft, pickRandom(unowned.length ? unowned : targets, random), "synthesis"))
	}
	Object.assign(state, draft)
	return results
}

/* -------------------------------- outfits -------------------------------- */

/** Equips a character, toggles an accessory, or toggles an emote in the five emote slots. */
function equip(state: CollectionState, items: CatalogItem[], id: string): void {
	const item = items.find(candidate => candidate.id === id)
	if (!item || !state.owned[id]) throw Error("Obtain this item first")

	switch (item.type) {
		case "character":
			state.character = id
			return
		case "accessory":
			state.accessory = state.accessory === id ? "" : id
			return
		case "emote":
			if (state.emotes.includes(id)) {
				state.emotes = state.emotes.filter(emote => emote !== id)
				return
			}
			if (state.emotes.length >= MAX_EMOTES) throw Error("Equip up to 5 emotes; remove one first")
			state.emotes.push(id)
	}
}

/** Puts an emote into `slot`. If it is already equipped elsewhere, the two slots swap. */
function replaceEmote(state: CollectionState, items: CatalogItem[], id: string, slot: number): void {
	if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_EMOTES) throw Error("Invalid emote slot")
	if (!state.owned[id] || !items.some(item => item.id === id && item.type === "emote"))
		throw Error("Obtain this emote first")

	const emotes = state.emotes
	const target = Math.min(slot, emotes.length)
	const current = emotes.indexOf(id)
	if (current === target) return

	if (current < 0) {
		emotes[target] = id
		return
	}
	const displaced = emotes[target]
	emotes[target] = id
	if (displaced) emotes[current] = displaced
	else emotes.splice(current, 1)
}

/* -------------------------------- counter -------------------------------- */

/**
 * Counts one tap. The counter wraps to 0 after `counterLimit`; when it wraps and auto-emote is on,
 * a random equipped emote id is returned for the pet to show.
 */
function registerTap(state: CollectionState, items: CatalogItem[], random: Random = Math.random): string | null {
	const today = localDateKey()
	if (state.dailyCountDate !== today) {
		state.dailyCount = 0
		state.dailyCountDate = today
	}
	state.totalCount = Math.min(Number.MAX_SAFE_INTEGER, state.totalCount + 1)
	state.dailyCount++

	const limit = state.settings.counterLimit
	state.count = limit !== null && state.count >= limit ? 0 : state.count + 1
	if (!state.settings.autoEmote || state.count !== 0) return null

	const equipped = items.filter(
		item => item.type === "emote" && state.owned[item.id] > 0 && state.emotes.includes(item.id),
	)
	return equipped.length ? pickRandom(equipped, random).id : null
}

export { draw, synthesize, equip, registerTap, replaceEmote }
