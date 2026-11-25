import { computed, ref, shallowRef } from "vue"
import {
	cleanRedeemCode,
	cleanRoomNumber,
	clickBalance,
	isValidCode,
	isValidUid,
	parseChestResult,
	parseRoom,
	parseUser,
	type ChestResult,
	type OnlineRoom,
	type OnlineUser,
} from "../../../domain/online"
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

export const balance = computed(() => clickBalance(user.value, spentClicks.value, pendingClicks.value))

const unexpected = (what: string) =>
	new Error(`The server's ${what} reply was not in the expected format (see "Online" in the README)`)

async function call<T>(method: "GET" | "POST", endpoint: string, body?: unknown): Promise<T> {
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
