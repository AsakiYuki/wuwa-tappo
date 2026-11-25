import { computed, ref, shallowRef } from "vue"
import {
	appearanceBody,
	cleanRedeemCode,
	cleanRoomNumber,
	clickBalance,
	isValidCode,
	isValidUid,
	parseChestResult,
	parsePresetList,
	parseRoom,
	parseUser,
	type ChestResult,
	type OnlinePreset,
	type OnlineRoom,
	type OnlineUser,
} from "../../../domain/online"
import type { OnlineLoginRole } from "../../../domain/types"
import type { OnlineReply } from "../../shared/types"
import { CHEST_PLACES, type ChestPlace } from "./config"

/*
 * The studio's online session. The login token never gets here: src-tauri/src/online.rs keeps it and
 * adds it to requests. Everything below only asks, validates what comes back, and keeps what the page
 * shows. Offline mode never calls any of it.
 */

const online = window.petAPI.online

export const user = shallowRef<OnlineUser | null>(null)
export const loggedIn = ref(false)
/** Taps since login that the server has not been told about, from the app. */
export const pendingClicks = ref(0)
/** Clicks spent on chests since `user` was last fetched (the fetch already counts them). */
export const spentClicks = ref(0)
export const busy = ref(false)
export const room = shallowRef<OnlineRoom | null>(null)

/** Where a browser login stands: nothing running, waiting for the callback/server, or choosing a role. */
export const loginStage = ref<"idle" | "browser" | "waiting" | "choose">("idle")
export const loginRoles = shallowRef<OnlineLoginRole[]>([])
export const loginError = ref("")

export const balance = computed(() => clickBalance(user.value, spentClicks.value, pendingClicks.value))

const unexpected = (what: string) =>
	new Error(`The server's ${what} reply was not in the expected format (see "Online" in the README)`)

async function call<T>(method: "GET" | "POST" | "PUT" | "DELETE", endpoint: string, body?: unknown): Promise<T> {
	const reply: OnlineReply<T> = await online.request<T>(method, endpoint, body)
	if (!reply.ok) throw new Error(reply.error || "The request failed")
	return reply.data as T
}

/** Runs one user action with the busy flag set; only one action runs at a time. */
async function exclusive<T>(action: () => Promise<T>): Promise<T> {
	if (busy.value) throw new Error("Another request is still running")
	busy.value = true
	try {
		return await action()
	} finally {
		busy.value = false
	}
}

/** Reads whether a session exists and the unreported clicks; false if the app cannot say. */
export async function refreshStatus(): Promise<boolean> {
	try {
		const status = await online.status()
		if (!status.ok) return false
		loggedIn.value = status.loggedIn
		pendingClicks.value = Number.isSafeInteger(status.pendingClicks) ? Math.max(0, status.pendingClicks) : 0
		if (!status.loggedIn) {
			user.value = null
			room.value = null
		}
		return true
	} catch {
		return false
	}
}

async function fetchUser() {
	const parsed = parseUser(await call("GET", "api/frontend/user/me"))
	if (!parsed) throw unexpected("account")
	user.value = parsed
	spentClicks.value = 0
}

/** Loads the account for a session that already exists (after a restart, or when online mode is turned on). */
export function refreshAccount() {
	return exclusive(async () => {
		if (!(await refreshStatus()) || !loggedIn.value) return
		await fetchUser()
	})
}

export function sendCode(uid: string) {
	if (!isValidUid(uid)) throw new Error("Enter a valid UID (9 to 15 digits)")
	return exclusive(() => call("POST", "api/auth/uid-send-code", { playerId: Number(uid.trim()) }))
}

export function login(uid: string, code: string) {
	if (!isValidUid(uid)) throw new Error("Enter a valid UID (9 to 15 digits)")
	if (!isValidCode(code)) throw new Error("Enter the 6-digit confirmation code")
	return exclusive(async () => {
		const data = await call<{ user?: unknown }>("POST", "api/auth/uid-login", {
			playerId: Number(uid.trim()),
			code: Number(code.trim()),
		})
		if (!(await refreshStatus()) || !loggedIn.value) throw unexpected("login")
		// The login reply normally carries the account; if not, ask for it.
		const parsed = parseUser(data?.user)
		if (parsed) {
			user.value = parsed
			spentClicks.value = 0
		} else {
			await fetchUser()
		}
	})
}

/** Ends the session. The app reports the unseen clicks itself and forgets the token even if the server fails. */
export function logout() {
	return exclusive(async () => {
		try {
			await call("POST", "api/frontend/user/logout")
		} finally {
			await refreshStatus()
			user.value = null
			room.value = null
			spentClicks.value = 0
		}
	})
}

export function renewSession() {
	return exclusive(async () => {
		await call("GET", "api/frontend/user/renew-token")
		await refreshStatus()
		await fetchUser()
	})
}

export function openChest(chest: ChestPlace): Promise<ChestResult> {
	if (!CHEST_PLACES.includes(chest)) throw new Error("Unknown chest")
	if (balance.value < chest.cost) throw new Error("Not enough clicks for this chest")
	return exclusive(async () => {
		const data = await call("POST", "api/frontend/chests/open", { place: chest.place, click_num: chest.cost })
		// The server has charged by now, whatever the reply looks like.
		spentClicks.value += chest.cost
		const result = parseChestResult(data)
		if (!result) throw unexpected("chest")
		return result
	})
}

export function redeem(code: string) {
	const clean = cleanRedeemCode(code)
	if (!clean) throw new Error("Enter a valid redeem code")
	return exclusive(() => call("POST", "api/frontend/redeems/use", { code: clean }))
}

async function enter(endpoint: string, body: unknown) {
	const parsed = parseRoom(await call("POST", endpoint, body))
	if (!parsed) throw unexpected("room")
	room.value = parsed
}

export const createRoom = () => exclusive(() => enter("api/frontend/rooms", {}))
export const randomJoinRoom = () => exclusive(() => enter("api/frontend/rooms/random-join", {}))

export function joinRoom(number: string) {
	const clean = cleanRoomNumber(number)
	if (!clean) throw new Error("Enter a valid room number")
	return exclusive(() => enter("api/frontend/rooms/join", { room_no: clean }))
}

export function setRoomPublic(isPublic: boolean) {
	const current = room.value
	if (!current) throw new Error("You are not in a room")
	return exclusive(async () => {
		await call("POST", "api/frontend/rooms/public", { room_no: current.roomNo, is_public: isPublic })
		room.value = { ...current, isPublic }
	})
}

/** Leaving is local only: the original client had no leave request. */
export function leaveRoom() {
	room.value = null
}

const positiveIds = (ids: number[]) => ids.every(id => Number.isSafeInteger(id) && id > 0)

/** The account's presets on the server (not merged into the studio's own presets). */
export function listPresets(): Promise<OnlinePreset[]> {
	return exclusive(async () => {
		const presets = parsePresetList(await call("GET", "api/frontend/presets"))
		if (!presets) throw unexpected("presets")
		return presets
	})
}

export function createPreset(character: number, accessory: number | null, emotes: number[]) {
	const body = appearanceBody(character, accessory, emotes)
	if (!body) throw new Error("Pick a character first")
	return exclusive(() => call("POST", "api/frontend/presets", body))
}

export function deletePreset(presetId: number) {
	if (!Number.isSafeInteger(presetId) || presetId < 0) throw new Error("Unknown preset")
	return exclusive(() => call("DELETE", "api/frontend/presets", { preset_id: presetId }))
}

/** Tells the server which outfit and emotes the account wears (what other room members see). */
export function saveAppearance(character: number, accessory: number | null, emotes: number[]) {
	const body = appearanceBody(character, accessory, emotes)
	if (!body) throw new Error("Pick a character first")
	return exclusive(() => call("PUT", "api/frontend/user/me/appearance", body))
}

export function setFavorite(assetId: number, favorite: boolean) {
	if (!positiveIds([assetId])) throw new Error("Unknown item")
	return exclusive(() =>
		call("POST", favorite ? "api/frontend/assets/favorites" : "api/frontend/assets/favorites/cancel", {
			asset_id: assetId,
		}),
	)
}

/** Trades duplicates for a new item. `sameLevel` picks the original's same-rarity route over the next-rarity one. */
export function synthesize(assetIds: number[], sameLevel: boolean) {
	if (assetIds.length === 0 || assetIds.length > 20 || !positiveIds(assetIds)) throw new Error("Pick the items to trade")
	return exclusive(() =>
		call("POST", sameLevel ? "api/frontend/assets/synthesis/same-level" : "api/frontend/assets/synthesis", {
			asset_ids: assetIds,
		}),
	)
}

/* ---- Browser (passport) login: the app holds the passport token; this only follows its progress. ---- */

online.onLogin(event => {
	loginError.value = ""
	if (event.stage === "waiting") loginStage.value = "waiting"
	else if (event.stage === "choose") {
		loginRoles.value = event.roles
		loginStage.value = "choose"
	} else if (event.stage === "failed") {
		loginStage.value = "idle"
		loginRoles.value = []
		loginError.value = event.message
	} else {
		loginStage.value = "idle"
		loginRoles.value = []
		void refreshAccount().catch(error => {
			loginError.value = error instanceof Error ? error.message : String(error)
		})
	}
})

export async function startBrowserLogin() {
	loginError.value = ""
	const reply = await online.loginStart(navigator.language.split("-")[0] || "en")
	if (!reply.ok) throw new Error(reply.error || "Could not start the login")
	loginStage.value = "browser"
}

export async function chooseRole(index: number) {
	const reply = await online.loginChoose(index)
	if (!reply.ok) throw new Error(reply.error || "Could not choose the role")
	loginStage.value = "waiting"
}

export async function cancelBrowserLogin() {
	await online.loginCancel()
	loginStage.value = "idle"
	loginRoles.value = []
}
