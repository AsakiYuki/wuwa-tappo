import { computed, ref, shallowRef, watch } from "vue"
import {
	appearanceBody,
	cleanRedeemCode,
	cleanRoomNumber,
	clickBalance,
	isValidCode,
	isValidUid,
	parseBag,
	parseChestResult,
	parsePresetList,
	parseRoom,
	parseUser,
	type ChestResult,
	type OnlinePreset,
	type OnlineRoom,
	type OnlineUser,
} from "../../../domain/online"
import type { OnlineLoginRole, RoomSocketMember } from "../../../domain/types"
import type { OnlineReply } from "../../shared/types"
import { command, items, state } from "../store"
import {
	CHEST_PLACES,
	CODE_COOLDOWN_SECONDS,
	CODE_RATE_LIMIT_SECONDS,
	LOGIN_ERROR_TEXT,
	LOGIN_RESTART_DELAY_MS,
	type ChestPlace,
} from "./config"

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
/** The room's members as the room socket reports them (empty until it is connected). */
export const roomMembers = shallowRef<RoomSocketMember[]>([])
export const roomLink = ref<"idle" | "connecting" | "connected" | "reconnecting">("idle")
/** Why the room socket could not be used or ended, for the page to show. */
export const roomNotice = ref("")
/** Why the account's bag could not be loaded (the online profile then owns only the starter items). */
export const bagNotice = ref("")

/** Where a browser login stands: nothing running, waiting for the callback/server, or choosing a role. */
export const loginStage = ref<"idle" | "browser" | "waiting" | "choose">("idle")
export const loginRoles = shallowRef<OnlineLoginRole[]>([])
export const loginError = ref("")
/** The role choice is for changing character while logged in (no browser login behind it). */
export const loginSwitching = ref(false)

/* When the confirmation code may be asked for again (ms since the epoch; 0 = now). Kept across restarts of the page like the original's countdown. */
const COOLDOWN_KEY = "wuwa-code-cooldown-end"
function loadCooldownEnd(): number {
	try {
		const value = Number(localStorage.getItem(COOLDOWN_KEY))
		return Number.isFinite(value) && value > Date.now() ? value : 0
	} catch {
		return 0
	}
}
export const codeCooldownEnd = ref(loadCooldownEnd())
function setCooldown(seconds: number) {
	codeCooldownEnd.value = Date.now() + seconds * 1000
	try {
		localStorage.setItem(COOLDOWN_KEY, String(codeCooldownEnd.value))
	} catch {
		/* the countdown just does not survive a restart */
	}
}

/** The server code inside an error text the app built (`... (code N, HTTP M)` or `Error code: N ...`). */
export function errorCode(message: string): number | null {
	const match = /\(code (-?\d+)[,)]/.exec(message) ?? /^Error code: (-?\d+)/.exec(message)
	return match ? Number(match[1]) : null
}

/** The original's wording for the login-related codes; any other message stays as the server sent it. */
function loginMessage(message: string): string {
	const code = errorCode(message)
	return (code !== null && LOGIN_ERROR_TEXT[code]) || message
}

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
			roomMembers.value = []
			roomLink.value = "idle"
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
	await syncBag()
	await adoptRoom()
}

/**
 * The online profile owns what the account's bag lists, not what the offline collection has: the bag is
 * fetched and handed to the collection (domain/profile.ts). A failure is a notice; the profile stays as it was.
 */
async function syncBag() {
	bagNotice.value = ""
	try {
		const entries = parseBag(await call("POST", "api/frontend/bags/list", {}))
		if (!entries) {
			bagNotice.value = "The server's bag reply was not in the expected format (see 'Online' in the README)"
			return
		}
		const result = await command("online-bag", entries)
		if (!result.ok) bagNotice.value = result.error || "Could not apply the bag"
	} catch (error) {
		bagNotice.value = error instanceof Error ? error.message : String(error)
	}
}

/** Loads the account for a session that already exists (after a restart, or when online mode is turned on). */
export function refreshAccount() {
	return exclusive(async () => {
		if (!(await refreshStatus()) || !loggedIn.value) return
		await fetchUser()
	})
}

/** Asks for a confirmation code; starts the 60 s wait, or the 15 min wait when the server says "too many requests" (10031). */
export function sendCode(uid: string) {
	if (!isValidUid(uid)) throw new Error("Enter a valid UID (9 to 15 digits)")
	if (codeCooldownEnd.value > Date.now()) throw new Error("Wait before asking for another code")
	return exclusive(async () => {
		try {
			await call("POST", "api/auth/uid-send-code", { playerId: Number(uid.trim()) })
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			if (errorCode(message) === 10031) {
				setCooldown(CODE_RATE_LIMIT_SECONDS)
				throw new Error("Too many requests; wait 15 minutes before asking for another code")
			}
			throw new Error(loginMessage(message))
		}
		setCooldown(CODE_COOLDOWN_SECONDS)
	})
}

export function login(uid: string, code: string) {
	if (!isValidUid(uid)) throw new Error("Enter a valid UID (9 to 15 digits)")
	if (!isValidCode(code)) throw new Error("Enter the 6-digit confirmation code")
	return exclusive(async () => {
		const data = await call<{ user?: unknown }>("POST", "api/auth/uid-login", {
			playerId: Number(uid.trim()),
			code: Number(code.trim()),
		}).catch(error => {
			throw new Error(loginMessage(error instanceof Error ? error.message : String(error)))
		})
		if (!(await refreshStatus()) || !loggedIn.value) throw unexpected("login")
		// The login reply normally carries the account; if not, ask for it.
		const parsed = parseUser(data?.user)
		if (parsed) {
			user.value = parsed
			spentClicks.value = 0
			await adoptRoom()
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
			roomMembers.value = []
			roomLink.value = "idle"
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

/** The equipped outfit as the server knows it: catalog asset ids. Null while the catalog is not loaded. */
function currentLooks() {
	const current = state.value
	if (!current) return null
	const asset = (id: string) => items.value.find(item => item.id === id)?.assetId
	const character = asset(current.character)
	if (!character) return null
	return {
		character,
		accessory: current.accessory ? (asset(current.accessory) ?? null) : null,
		emotes: current.emotes.map(asset).filter((id): id is number => typeof id === "number" && id > 0),
	}
}

/**
 * Opens the room socket for a room the server just let this user into. The outfit is saved to the account
 * first, so the others see it (the server reads it from there); every failure here is only a notice, the
 * room itself already exists.
 */
async function connectRoom(roomNo: string) {
	roomNotice.value = ""
	const looks = currentLooks()
	const body = looks && appearanceBody(looks.character, looks.accessory, looks.emotes)
	if (body) {
		await call("PUT", "api/frontend/user/me/appearance", body).catch(error => {
			roomNotice.value = `Your outfit could not be saved to the account: ${error instanceof Error ? error.message : error}`
		})
	}
	// Told to the room as soon as the socket is ready (rc with b and c).
	if (looks) await online.roomLooks(looks.character, looks.accessory ?? 0)
	// Without the account's numeric id the room still works, but this user's own pet cannot be left out of the others'.
	const reply = await online.roomConnect(roomNo, user.value?.id ?? 0)
	if (!reply.ok) roomNotice.value = reply.error || "Could not connect to the room"
	else roomLink.value = "connecting"
}

/**
 * The server still has this account in a room (it was left open, or the app restarted): take that room
 * up again, as the original does at login and on code 80003. False if there is none.
 */
async function adoptRoom(): Promise<boolean> {
	const roomNo = user.value?.roomNo
	if (!roomNo) return false
	if (room.value?.roomNo !== roomNo) {
		room.value = { roomNo, isPublic: room.value?.isPublic ?? true, members: [] }
		await connectRoom(roomNo)
	}
	return true
}

async function enter(endpoint: string, body: unknown) {
	let reply: unknown
	try {
		reply = await call("POST", endpoint, body)
	} catch (error) {
		// 80003: still in a room. Not a failure: that room is the one to be in.
		if (errorCode(error instanceof Error ? error.message : String(error)) === 80003) {
			await fetchUser()
			if (await adoptRoom()) {
				roomNotice.value = `You are already in room ${room.value?.roomNo}`
				return
			}
		}
		throw error
	}
	const parsed = parseRoom(reply)
	if (!parsed) throw unexpected("room")
	room.value = parsed
	await connectRoom(parsed.roomNo)
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

/** The eye in the member list: show or hide one member's pet on the desktop. */
export async function showMember(userId: number, shown: boolean) {
	const reply = await online.roomShowMember(userId, shown)
	if (!reply.ok) throw new Error(reply.error || "Could not change the pet's visibility")
}

/** The owner's actions on another member (`kick`, `transfer` host). The server's answer arrives as a notice. */
export async function memberAction(action: "kick" | "transfer", userId: number) {
	const reply = await online.roomMember(action, userId)
	if (!reply.ok) throw new Error(reply.error || "Could not send the request")
}

// A chest opened on the desktop put an item in the account's bag.
window.petAPI.onChestOpened(() => {
	if (user.value) void syncBag()
})

online.onRoomError(event => {
	roomNotice.value = event.message
})

/** Leaves the room: the socket says goodbye (`rl`) and closes; the pets disappear. */
export function leaveRoom() {
	void online.roomLeave()
	room.value = null
	roomMembers.value = []
	roomLink.value = "idle"
}

online.onRoomMembers(event => {
	roomMembers.value = event.members
	const current = room.value
	if (current && event.isPublic !== null && current.isPublic !== event.isPublic)
		room.value = { ...current, isPublic: event.isPublic }
})

online.onRoomStatus(event => {
	if (event.state !== "ended") {
		roomLink.value = event.state
		// Why the last attempt failed, so a room that never connects is not silent.
		if (event.state === "reconnecting") roomNotice.value = event.message
		else if (event.state === "connected") roomNotice.value = ""
		return
	}
	roomLink.value = "idle"
	roomMembers.value = []
	// Leaving oneself is not news; being removed or the room ending is.
	if (event.message) {
		roomNotice.value = event.message
		if (event.reason === "dismissed" || event.reason === "kicked" || event.reason === "forced") room.value = null
	}
})

/*
 * What this user wears is told to the account and the room whenever it changes (the original sends
 * `rc { b, c }` after saving the appearance). Only the online profile's outfit counts.
 */
let looksTimer: ReturnType<typeof setTimeout> | undefined
async function announceLooks() {
	const looks = currentLooks()
	if (!loggedIn.value || !state.value?.settings.onlineMode || !looks) return
	const body = appearanceBody(looks.character, looks.accessory, looks.emotes)
	if (body) await call("PUT", "api/frontend/user/me/appearance", body).catch(() => undefined)
	await online.roomLooks(looks.character, looks.accessory ?? 0)
}
watch(
	() => {
		const current = state.value
		return current
			? `${current.settings.onlineMode}|${current.character}|${current.accessory}|${current.emotes.join(",")}`
			: ""
	},
	() => {
		clearTimeout(looksTimer)
		looksTimer = setTimeout(() => void announceLooks(), 600)
	},
)

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
	if (assetIds.length === 0 || assetIds.length > 20 || !positiveIds(assetIds))
		throw new Error("Pick the items to trade")
	return exclusive(() =>
		call("POST", sameLevel ? "api/frontend/assets/synthesis/same-level" : "api/frontend/assets/synthesis", {
			asset_ids: assetIds,
		}),
	)
}

/* ---- Browser (passport) login: the app holds the passport token; this only follows its progress. ---- */

let restartTimer: ReturnType<typeof setTimeout> | undefined

online.onLogin(event => {
	loginError.value = ""
	if (event.stage === "waiting") loginStage.value = "waiting"
	else if (event.stage === "choose") {
		loginRoles.value = event.roles
		loginSwitching.value = event.switch
		loginStage.value = "choose"
	} else if (event.stage === "failed") {
		loginStage.value = "idle"
		loginRoles.value = []
		loginSwitching.value = false
		loginError.value = loginMessage(event.message)
		// The login was refused as expired or invalid: the original shows the message and starts over.
		if (event.restart) {
			clearTimeout(restartTimer)
			restartTimer = setTimeout(() => {
				void refreshStatus().then(() => {
					if (!loggedIn.value) void startBrowserLogin().catch(() => undefined)
				})
			}, LOGIN_RESTART_DELAY_MS)
		}
	} else {
		loginStage.value = "idle"
		loginRoles.value = []
		loginSwitching.value = false
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

/** Changes character with the last login's passport (the app asks the server for the roles again). */
export async function switchCharacter() {
	loginError.value = ""
	const reply = await online.loginSwitch()
	if (!reply.ok) throw new Error(reply.error || "Could not switch character")
	loginStage.value = "waiting"
}

export async function cancelBrowserLogin() {
	clearTimeout(restartTimer)
	await online.loginCancel()
	loginStage.value = "idle"
	loginRoles.value = []
	loginSwitching.value = false
}
