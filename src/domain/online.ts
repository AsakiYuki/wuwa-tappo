import type { CatalogItem } from "./types.js"

/*
 * Online mode: pure parsing and arithmetic for what the Kuro Games server sends. No I/O here; the
 * requests are made by src-tauri/src/online.rs and src/renderer/studio/online/.
 *
 * Provenance: every field name below comes from the decompiled frontend (wuwa-tappo-frontend,
 * build 1.0.5: api/kuro.ts, stores/global.ts, components/panel/MainPanelExchangeTab.vue). None of it
 * has been checked against live server traffic, so each parser rejects what it does not recognise
 * instead of guessing.
 */

/** Largest number a count may be; keeps sums exact in a double. */
const MAX_COUNT = Number.MAX_SAFE_INTEGER

/** A click count from the server: a non-negative whole number, else 0 (as the original client did). */
export function parseCount(value: unknown): number {
	const number = Number(value)
	return Number.isFinite(number) ? Math.min(MAX_COUNT, Math.max(0, Math.floor(number))) : 0
}

export interface OnlineUser {
	userId: string
	/** The account's numeric `id`, which the room socket identifies members by (original: `userInfo.id`). */
	id: number | null
	nickname: string
	/** `player_type` as sent; the original client only special-cases 2 and its meaning is unknown. */
	playerType: number | null
	/** `total_click_count`: every click the server has credited. */
	totalClicks: number
	/** `total_click_consume`: clicks the server has already charged. */
	consumedClicks: number
}

/** `api/frontend/user/me` (and the `user` of a login reply). Null if there is no usable id (`user_id`, else `player_id`, `cuid`, `puid`). */
export function parseUser(raw: unknown): OnlineUser | null {
	if (!raw || typeof raw !== "object") return null
	const record = raw as Record<string, unknown>
	// A UID login's account has `user_id`; a Kuro passport account's `user/me` (original build 1.0.5, store
	// `userInfo`) carries `cuid`, `puid`, `player_id` and `nickname` instead.
	const id = [record.user_id, record.player_id, record.cuid, record.puid].find(
		value => (typeof value === "string" || typeof value === "number") && String(value).trim() !== "",
	)
	if (id === undefined) return null
	const nickname = typeof record.nickname === "string" ? record.nickname.trim().slice(0, 64) : ""
	return {
		userId: String(id).slice(0, 32),
		id: typeof record.id === "number" && Number.isSafeInteger(record.id) && record.id > 0 ? record.id : null,
		nickname: nickname || "Rover",
		playerType: Number.isInteger(record.player_type) ? (record.player_type as number) : null,
		totalClicks: parseCount(record.total_click_count),
		consumedClicks: parseCount(record.total_click_consume),
	}
}

/**
 * Clicks the user can spend: what the server credited, minus what it charged and what this session
 * has already spent, plus clicks made since login that the server has not seen (`pending`).
 * Same formula as `totalClickCount` in the original client's store.
 */
export function clickBalance(user: OnlineUser | null, spentThisSession: number, pending: number): number {
	if (!user) return 0
	const net = user.totalClicks - user.consumedClicks - parseCount(spentThisSession)
	return Math.min(MAX_COUNT, Math.max(0, Math.floor(net + parseCount(pending))))
}

export interface ChestReward {
	assetId: number
	name: string
	type: string
	rarity: string
}

export interface ChestResult {
	rewards: ChestReward[]
	remainingClicks: number | null
}

/** Most rewards one chest can show; a longer list is not a chest result. */
const MAX_REWARDS = 100

/** `api/frontend/chests/open`: `{ rewards: [{ id, name, type, rarity }], remaining_clicks }`. */
export function parseChestResult(raw: unknown): ChestResult | null {
	if (!raw || typeof raw !== "object") return null
	const record = raw as Record<string, unknown>
	if (!Array.isArray(record.rewards) || record.rewards.length > MAX_REWARDS) return null
	const rewards: ChestReward[] = []
	for (const reward of record.rewards) {
		if (!reward || typeof reward !== "object") return null
		const { id, name, type, rarity } = reward as Record<string, unknown>
		if (!Number.isSafeInteger(id)) return null
		rewards.push({
			assetId: id as number,
			name: typeof name === "string" ? name.slice(0, 64) : "",
			type: typeof type === "string" ? type.slice(0, 32) : "",
			rarity: typeof rarity === "string" ? rarity.slice(0, 32) : "",
		})
	}
	return {
		rewards,
		remainingClicks: record.remaining_clicks === undefined ? null : parseCount(record.remaining_clicks),
	}
}

export interface RoomMember {
	userId: string
	nickname: string
}

export interface OnlineRoom {
	roomNo: string
	isPublic: boolean
	members: RoomMember[]
}

const MAX_ROOM_MEMBERS = 64

/** A room as `rooms`, `rooms/join` and `rooms/random-join` return it: `{ room_no, is_public, members }`. */
export function parseRoom(raw: unknown): OnlineRoom | null {
	if (!raw || typeof raw !== "object") return null
	const record = raw as Record<string, unknown>
	const number = record.room_no
	if ((typeof number !== "string" && typeof number !== "number") || String(number).trim() === "") return null
	if (record.members !== undefined && (!Array.isArray(record.members) || record.members.length > MAX_ROOM_MEMBERS))
		return null
	const members: RoomMember[] = []
	for (const member of (record.members as unknown[] | undefined) ?? []) {
		const entry = (member ?? {}) as Record<string, unknown>
		members.push({
			userId:
				typeof entry.user_id === "string" || typeof entry.user_id === "number"
					? String(entry.user_id).slice(0, 32)
					: "",
			nickname: typeof entry.nickname === "string" ? entry.nickname.trim().slice(0, 64) || "Rover" : "Rover",
		})
	}
	return { roomNo: String(number).slice(0, 32), isPublic: record.is_public !== false, members }
}

/** A room number as typed for joining: letters and digits only, bounded. Null if it cannot be one. */
export function cleanRoomNumber(text: string): string | null {
	const number = text.trim()
	return /^[A-Za-z0-9]{1,32}$/.test(number) ? number : null
}

/**
 * The local catalog item for a server asset id. Assumes the server's asset ids are the catalog's
 * `assetId`s (both are unique integers; unconfirmed against a real reply), so a miss is normal and
 * the caller falls back to the name the server sent.
 */
export function itemForAsset(items: CatalogItem[], assetId: number): CatalogItem | undefined {
	return items.find(item => item.assetId === assetId)
}

/**
 * A UID as the login form accepts it. The original client required 9 or more digits and sends the
 * UID as a JSON number, so it is capped at 15 digits here to stay exact in a double.
 */
export const isValidUid = (text: string) => /^[0-9]{9,15}$/.test(text.trim())

/** The 6-digit confirmation code sent to the player. */
export const isValidCode = (text: string) => /^[0-9]{6}$/.test(text.trim())

/** A redeem code as typed: trimmed, bounded, printable ASCII only. Null if it cannot be one. */
export function cleanRedeemCode(text: string): string | null {
	const code = text.trim()
	return /^[\x21-\x7e]{1,64}$/.test(code) ? code : null
}

export interface OnlinePresetEmote {
	assetId: number
	name: string
	x: number | null
	y: number | null
}

export interface OnlinePreset {
	presetId: number
	characterAssetId: number
	accessoryAssetId: number | null
	emotes: OnlinePresetEmote[] | null
}

const MAX_PRESETS = 200
const MAX_PRESET_EMOTES = 16

const finite = (value: unknown): number | null => {
	const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN
	return Number.isFinite(number) ? number : null
}

/**
 * `api/frontend/presets` (GET). Port of `normalizePresetList` in the original bundle (build 1.0.5): an
 * entry needs a positive `character_asset_id`; `preset_id` falls back to `id`, then the index.
 * Offsets (`*_offset_x`, `*_my_offset_x`) are not read: the studio draws from its own catalog.
 * Returns null when the reply is not a list or is implausibly long.
 */
export function parsePresetList(raw: unknown): OnlinePreset[] | null {
	if (!Array.isArray(raw) || raw.length > MAX_PRESETS) return null
	const presets: OnlinePreset[] = []
	raw.forEach((entry, index) => {
		if (!entry || typeof entry !== "object") return
		const record = entry as Record<string, unknown>
		const character = finite(record.character_asset_id)
		if (character === null || character <= 0 || !Number.isSafeInteger(character)) return
		const accessory = finite(record.accessory_asset_id)
		const id = finite(record.preset_id ?? record.id)
		let emotes: OnlinePresetEmote[] | null = null
		if (Array.isArray(record.emotes)) {
			emotes = []
			for (const emote of record.emotes.slice(0, MAX_PRESET_EMOTES)) {
				if (!emote || typeof emote !== "object") continue
				const item = emote as Record<string, unknown>
				const assetId = finite(item.asset_id)
				if (assetId === null || assetId <= 0 || !Number.isSafeInteger(assetId)) continue
				emotes.push({
					assetId,
					name: typeof item.asset_name === "string" ? item.asset_name.slice(0, 64) : "",
					x: finite(item.x),
					y: finite(item.y),
				})
			}
		}
		presets.push({
			presetId: id !== null && Number.isSafeInteger(id) ? id : index,
			characterAssetId: character,
			accessoryAssetId: accessory !== null && accessory > 0 && Number.isSafeInteger(accessory) ? accessory : null,
			emotes,
		})
	})
	return presets
}

/** The body the server takes for appearance and preset saves: positive, unique, bounded asset ids. */
export function appearanceBody(character: number, accessory: number | null, emotes: number[]) {
	const valid = (id: unknown): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0
	if (!valid(character)) return null
	const unique = [...new Set(emotes.filter(valid))].slice(0, MAX_PRESET_EMOTES)
	return {
		character_asset_id: character,
		accessory_asset_id: accessory !== null && valid(accessory) ? accessory : 0,
		emote_asset_ids: unique,
	}
}
