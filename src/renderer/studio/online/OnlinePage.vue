<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue"
import type { ChestResult } from "../../../domain/online"
import { itemForAsset } from "../../../domain/online"
import { assetPath, itemName } from "../../shared/assets"
import { items, state, updateSettings } from "../store"
import { toast } from "../toast"
import { AGREEMENT_URL, CHEST_PLACES, PRIVACY_URL, SERVER_NAMES, STATUS_POLL_MS, type ChestPlace } from "./config"
import * as session from "./session"

const props = defineProps<{ visible: boolean }>()

const uid = ref("")
const code = ref("")
const agreed = ref(false)
const redeemCode = ref("")
const roomNumber = ref("")
const lastChest = ref<ChestResult | null>(null)

const enabled = computed(() => state.value?.settings.onlineMode === true)
const {
	busy,
	loggedIn,
	user,
	room,
	balance,
	pendingClicks,
	loginStage,
	loginRoles,
	loginError,
	loginSwitching,
	roomMembers,
	roomLink,
	roomNotice,
} = session

/** The server's cap on members per room (the original shows "n/20"). */
const MAX_ROOM_MEMBERS = 20
const memberCount = computed(() =>
	roomMembers.value.length > 0 ? roomMembers.value.length : (room.value?.members.length ?? 0),
)
const isOwner = computed(() => roomMembers.value.some(member => member.owner && member.id === user.value?.id))

async function copyRoomId() {
	try {
		await navigator.clipboard.writeText(room.value?.roomNo ?? "")
		toast("Room ID copied")
	} catch {
		toast("Could not copy the room ID")
	}
}

/* Role choice, as the original's dialog: first the server, then (when it has several) the character. */
const serverId = ref("")
const roleIndex = ref(-1)
const serverName = (id: string) => SERVER_NAMES[id] ?? id
const servers = computed(() => [...new Set(loginRoles.value.map(role => role.serverId))])
const serverRoles = computed(() =>
	loginRoles.value.map((role, index) => ({ role, index })).filter(entry => entry.role.serverId === serverId.value),
)
watch(loginRoles, () => {
	serverId.value = ""
	roleIndex.value = -1
})
watch(serverId, () => {
	roleIndex.value = serverRoles.value.length === 1 ? serverRoles.value[0].index : -1
})
const chosenRole = computed(() => (roleIndex.value >= 0 ? loginRoles.value[roleIndex.value] : undefined))
const choosing = computed(() => loginStage.value === "choose" && loginRoles.value.length > 0)

async function confirmRole() {
	if (!serverId.value) return toast("Select a server")
	if (!chosenRole.value) return toast("Select a character")
	await attempt(() => session.chooseRole(roleIndex.value))
}

watch(loginError, message => {
	if (message && loggedIn.value) toast(message)
})

/** Runs a user action and shows its error as a toast; returns whether it succeeded. */
async function attempt(action: () => unknown, success?: string): Promise<boolean> {
	try {
		await action()
		if (success) toast(success)
		return true
	} catch (error) {
		toast(error instanceof Error ? error.message : String(error))
		return false
	}
}

/* The wait for another code comes from the session (60 s, or 15 min after "too many requests"). */
const now = ref(Date.now())
const cooldownTimer = setInterval(() => (now.value = Date.now()), 1000)
const cooldown = computed(() => Math.max(0, Math.ceil((session.codeCooldownEnd.value - now.value) / 1000)))
const cooldownLabel = computed(() =>
	cooldown.value > 60
		? `Sent ${Math.floor(cooldown.value / 60)}m ${cooldown.value % 60}s`
		: `Resend in ${cooldown.value}s`,
)

function sendCode() {
	now.value = Date.now()
	return attempt(() => session.sendCode(uid.value), "Confirmation code sent")
}

async function logIn() {
	if (!agreed.value) return toast("Agree to the User Agreement and Privacy Policy first")
	if (await attempt(() => session.login(uid.value, code.value), "Logged in")) code.value = ""
}

async function openChest(chest: ChestPlace) {
	try {
		lastChest.value = await session.openChest(chest)
	} catch (error) {
		toast(error instanceof Error ? error.message : String(error))
	}
}

async function redeem() {
	if (await attempt(() => session.redeem(redeemCode.value), "Code redeemed")) redeemCode.value = ""
}

const rewardCards = computed(() =>
	(lastChest.value?.rewards ?? []).map((reward, index) => {
		const item = itemForAsset(items.value, reward.assetId)
		return {
			key: `${reward.assetId}-${index}`,
			name: item ? itemName(item) : reward.name || `Item ${reward.assetId}`,
			thumbnail: item ? assetPath(item.thumbnail) : "",
			rarity: item?.rarity ?? "",
		}
	}),
)

/* While the page is open the app is asked how many clicks the server has not seen. */
let poll: ReturnType<typeof setInterval> | undefined
function stopPolling() {
	clearInterval(poll)
	poll = undefined
}
watch(
	() => props.visible && enabled.value,
	active => {
		stopPolling()
		if (!active) return
		void attempt(() => session.refreshAccount())
		poll = setInterval(() => void session.refreshStatus(), STATUS_POLL_MS)
	},
	{ immediate: true },
)
onBeforeUnmount(() => {
	stopPolling()
	clearInterval(cooldownTimer)
})
</script>

<template>
	<section id="page-online" class="page module-block online-page" :hidden="!visible">
		<div class="panel-content online-content">
			<div class="section-title">
				<h3>Online Account</h3>
				<span v-if="loggedIn && user">UID {{ user.userId }}</span>
			</div>

			<form v-if="choosing" class="online-card" @submit.prevent="confirmRole">
				<p class="online-note">
					{{
						loginSwitching
							? "Choose the character to switch to."
							: "Choose the server and character to log in with."
					}}
				</p>
				<div class="online-row">
					<select v-model="serverId" class="online-input" aria-label="Server" :disabled="busy">
						<option value="" disabled>Select a server</option>
						<option v-for="id in servers" :key="id" :value="id">{{ serverName(id) }}</option>
					</select>
					<select
						v-if="serverRoles.length > 1"
						v-model.number="roleIndex"
						class="online-input"
						aria-label="Character"
						:disabled="busy"
					>
						<option :value="-1" disabled>Select a character</option>
						<option v-for="entry in serverRoles" :key="entry.role.playerId" :value="entry.index">
							{{ entry.role.name || "Player" }} ({{ entry.role.playerId }})
						</option>
					</select>
				</div>
				<p v-if="chosenRole" class="online-note">
					{{ chosenRole.playerId }}<template v-if="chosenRole.name"> · {{ chosenRole.name }}</template>
				</p>
				<div class="online-row">
					<button class="common-btn" type="submit" :disabled="busy || !chosenRole">Confirm</button>
					<button class="common-btn" type="button" @click="attempt(() => session.cancelBrowserLogin())">
						Cancel
					</button>
				</div>
			</form>

			<div v-if="!loggedIn && !choosing" class="online-card">
				<p class="online-note">
					Log in with your Kuro Games account: the login page opens in your browser and brings you back here.
				</p>
				<div class="online-row">
					<button
						class="common-btn"
						type="button"
						:disabled="loginStage === 'waiting'"
						@click="attempt(() => session.startBrowserLogin())"
					>
						{{
							loginStage === "browser"
								? "Open the login page again"
								: loginStage === "waiting"
									? "Logging in…"
									: "Log In with Kuro Account"
						}}
					</button>
					<button
						v-if="loginStage !== 'idle'"
						class="common-btn"
						type="button"
						@click="attempt(() => session.cancelBrowserLogin())"
					>
						Cancel
					</button>
				</div>
				<p v-if="loginError" class="online-note">{{ loginError }}</p>
			</div>

			<form v-if="!loggedIn && !choosing" class="online-card" @submit.prevent="logIn">
				<p class="online-note">Log in with your in-game UID. A confirmation code is sent to you in the game.</p>
				<div class="online-row">
					<input
						v-model="uid"
						class="online-input"
						aria-label="UID"
						placeholder="UID"
						inputmode="numeric"
						maxlength="15"
						autocomplete="off"
					/>
					<button class="common-btn" type="button" :disabled="busy || cooldown > 0" @click="sendCode">
						{{ cooldown > 0 ? cooldownLabel : "Send Code" }}
					</button>
				</div>
				<div class="online-row">
					<input
						v-model="code"
						class="online-input"
						aria-label="Confirmation code"
						placeholder="6-digit code"
						inputmode="numeric"
						maxlength="6"
						autocomplete="off"
					/>
					<button class="common-btn" type="submit" :disabled="busy || !agreed">Log In</button>
				</div>
				<label class="online-row online-note">
					<input v-model="agreed" type="checkbox" />
					<span>
						I have read and agree to the
						<a :href="AGREEMENT_URL" target="_blank" rel="noopener noreferrer">User Agreement</a> and
						<a :href="PRIVACY_URL" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
					</span>
				</label>
			</form>

			<template v-else>
				<div class="online-card">
					<div class="online-row online-row--between">
						<div>
							<strong>{{ user?.nickname ?? "Loading…" }}</strong>
							<p class="online-note">
								Clicks available: <strong>{{ balance.toLocaleString() }}</strong>
								<span v-if="pendingClicks > 0">
									({{ pendingClicks.toLocaleString() }} not yet reported)</span
								>
							</p>
						</div>
						<div class="online-row">
							<button
								class="common-btn"
								:disabled="busy"
								@click="attempt(() => session.refreshAccount())"
							>
								Refresh
							</button>
							<button
								class="common-btn"
								:disabled="busy || loginStage !== 'idle'"
								title="Pick another character of your Kuro account"
								@click="attempt(() => session.switchCharacter())"
							>
								Switch Character
							</button>
							<button
								class="common-btn"
								:disabled="busy"
								title="Ask the server for a new login token"
								@click="attempt(() => session.renewSession(), 'Session renewed')"
							>
								Renew
							</button>
							<button
								class="common-btn"
								:disabled="busy"
								@click="attempt(() => session.logout(), 'Logged out')"
							>
								Log Out
							</button>
						</div>
					</div>
				</div>

				<div class="section-title"><h3>Chests</h3></div>
				<div class="online-chests">
					<button
						v-for="chest in CHEST_PLACES"
						:key="chest.place"
						class="online-chest"
						:disabled="busy || balance < chest.cost"
						@click="openChest(chest)"
					>
						<img :src="assetPath(chest.image)" :alt="chest.label" draggable="false" />
						<span>{{ chest.label }}</span>
						<small>{{ chest.cost.toLocaleString() }} clicks</small>
					</button>
				</div>
				<div v-if="rewardCards.length" class="online-rewards">
					<article
						v-for="card in rewardCards"
						:key="card.key"
						class="online-reward"
						:class="`online-reward--${card.rarity}`"
					>
						<img v-if="card.thumbnail" :src="card.thumbnail" draggable="false" />
						<span>{{ card.name }}</span>
					</article>
				</div>
				<p v-if="lastChest" class="online-note">
					Rewards belong to your online account. They do not change the offline collection.
					<template v-if="lastChest.remainingClicks !== null">
						Server balance: {{ lastChest.remainingClicks.toLocaleString() }} clicks.
					</template>
				</p>

				<div class="section-title"><h3>Redeem Code</h3></div>
				<form class="online-row" @submit.prevent="redeem">
					<input
						v-model="redeemCode"
						class="online-input"
						aria-label="Redeem code"
						placeholder="Code"
						maxlength="64"
						autocomplete="off"
					/>
					<button class="common-btn" type="submit" :disabled="busy">Redeem</button>
				</form>

				<div class="section-title"><h3>Room</h3></div>
				<div v-if="!room" class="online-card">
					<div class="online-row">
						<button class="common-btn" :disabled="busy" @click="attempt(() => session.createRoom())">
							Create Room
						</button>
						<button class="common-btn" :disabled="busy" @click="attempt(() => session.randomJoinRoom())">
							Join Random
						</button>
					</div>
					<form class="online-row" @submit.prevent="attempt(() => session.joinRoom(roomNumber))">
						<input
							v-model="roomNumber"
							class="online-input"
							aria-label="Room number"
							placeholder="Room number"
							maxlength="32"
							autocomplete="off"
						/>
						<button class="common-btn" type="submit" :disabled="busy">Join</button>
					</form>
				</div>
				<div v-else class="online-card room-card">
					<div class="room-head">
						<div>
							<strong class="room-title">Room ({{ memberCount }}/{{ MAX_ROOM_MEMBERS }})</strong>
							<p class="online-note room-id">
								Room ID: {{ room.roomNo }}
								<button
									class="icon-btn"
									type="button"
									title="Copy room ID"
									aria-label="Copy room ID"
									@click="copyRoomId"
								>
									<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
										<path
											fill="currentColor"
											d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"
										/>
									</svg>
								</button>
							</p>
						</div>
						<button class="common-btn" type="button" @click="session.leaveRoom()">Leave Room</button>
					</div>

					<div v-if="isOwner" class="room-row">
						<div>
							<strong>Public Room</strong>
							<p class="online-note">
								Once enabled, other players can join this room via random matching.
							</p>
						</div>
						<label class="setting-switch">
							<input
								type="checkbox"
								aria-label="Public Room"
								:checked="room.isPublic"
								:disabled="busy"
								@change="
									attempt(() => session.setRoomPublic(($event.target as HTMLInputElement).checked))
								"
							/>
							<span class="setting-slider" />
						</label>
					</div>

					<div class="room-row">
						<strong>Only Show My Desktop Pet</strong>
						<label class="setting-switch">
							<input
								type="checkbox"
								aria-label="Only Show My Desktop Pet"
								:checked="state?.settings.onlyShowMyPet === true"
								@change="updateSettings({ onlyShowMyPet: ($event.target as HTMLInputElement).checked })"
							/>
							<span class="setting-slider" />
						</label>
					</div>

					<p v-if="roomLink === 'connecting' || roomLink === 'reconnecting'" class="online-note">
						{{ roomLink === "connecting" ? "Connecting to the room…" : "Reconnecting to the room…" }}
					</p>
					<p v-if="roomNotice" class="online-note">{{ roomNotice }}</p>

					<ul v-if="roomMembers.length > 0" class="room-members">
						<li
							v-for="member in roomMembers"
							:key="member.id"
							class="room-member"
							:class="{ 'is-offline': !member.online }"
						>
							<span class="room-crown" :title="member.owner ? 'Host' : ''">{{
								member.owner ? "👑" : ""
							}}</span>
							<span class="room-name">
								{{ member.nickname }}
								<em v-if="member.id === user?.id">(you)</em>
								<em v-else-if="!member.online">(offline)</em>
							</span>
							<template v-if="member.id !== user?.id">
								<button
									class="icon-btn"
									type="button"
									:class="{ 'is-off': member.hidden }"
									:title="member.hidden ? 'Show this pet' : 'Hide this pet'"
									:aria-label="member.hidden ? 'Show this pet' : 'Hide this pet'"
									:aria-pressed="!member.hidden"
									@click="attempt(() => session.showMember(member.id, member.hidden))"
								>
									<svg
										v-if="!member.hidden"
										viewBox="0 0 24 24"
										width="18"
										height="18"
										aria-hidden="true"
									>
										<path
											fill="currentColor"
											d="M12 5C7 5 2.7 8.1 1 12c1.7 3.9 6 7 11 7s9.3-3.1 11-7c-1.7-3.9-6-7-11-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zm0-7.2a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 0 0 0-5.4z"
										/>
									</svg>
									<svg v-else viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
										<path
											fill="currentColor"
											d="M2.4 3.8 1 5.2l3.2 3.2C2.9 9.5 1.8 10.7 1 12c1.7 3.9 6 7 11 7 1.7 0 3.3-.4 4.7-1l3.1 3.1 1.4-1.4L2.4 3.8zM12 16.5A4.5 4.5 0 0 1 7.5 12c0-.6.1-1.1.3-1.6l1.6 1.6a2.7 2.7 0 0 0 2.6 2.6l1.6 1.6c-.5.2-1 .3-1.6.3zM12 5c-.9 0-1.7.1-2.5.4l2 2c.2 0 .3-.1.5-.1a4.5 4.5 0 0 1 4.5 4.5c0 .2 0 .3-.1.5l3 3c1.3-1 2.4-2.3 3.1-3.9-1.7-3.9-6-7-11-7z"
										/>
									</svg>
								</button>
								<template v-if="isOwner">
									<button
										class="icon-btn"
										type="button"
										title="Remove from the room"
										aria-label="Remove from the room"
										@click="attempt(() => session.memberAction('kick', member.id))"
									>
										<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
											<path
												fill="currentColor"
												d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4l5.6 5.6L5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4z"
											/>
										</svg>
									</button>
									<button
										class="common-btn room-transfer"
										type="button"
										:disabled="!member.online"
										@click="attempt(() => session.memberAction('transfer', member.id))"
									>
										Transfer Host
									</button>
								</template>
							</template>
						</li>
					</ul>
					<ul v-else class="room-members">
						<li
							v-for="(member, index) in room.members"
							:key="`${member.userId}-${index}`"
							class="room-member"
						>
							<span class="room-crown"></span>
							<span class="room-name">{{ member.nickname }}</span>
						</li>
					</ul>
				</div>
			</template>
		</div>
	</section>
</template>

<style scoped>
.online-content {
	display: flex;
	flex-direction: column;
	gap: 12px;
	overflow-y: auto;
}
.online-card {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 12px 14px;
	border: 1px solid #e7c398;
	border-radius: 8px;
	background: #fdf5df;
	color: #8e5e43;
}
.online-note {
	margin: 0;
	font-size: 13px;
	color: #8e7b6a;
}
.online-row {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
}
.online-row--between {
	justify-content: space-between;
}
.online-input {
	flex: 1 1 180px;
	min-width: 0;
	height: 34px;
	padding: 0 10px;
	border: 1px solid #e7b77c;
	border-radius: 6px;
	background: #fff3dd;
	color: #8e5e43;
	font: inherit;
}
.online-check {
	display: flex;
	align-items: center;
	gap: 4px;
	font-size: 13px;
}
.online-chests {
	display: flex;
	flex-wrap: wrap;
	gap: 12px;
}
.online-chest {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 2px;
	width: 120px;
	padding: 10px;
	border: 1px solid #e7b77c;
	border-radius: 8px;
	background: #fff3dd;
	color: #8e5e43;
	cursor: pointer;
}
.online-chest:disabled {
	opacity: 0.45;
	cursor: not-allowed;
}
.online-chest img {
	width: 64px;
	height: 64px;
	object-fit: contain;
}
.online-rewards {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}
.online-reward {
	display: flex;
	flex-direction: column;
	align-items: center;
	width: 84px;
	padding: 6px;
	border: 1px solid #e7c398;
	border-radius: 6px;
	background: #fff3dd;
	font-size: 12px;
	text-align: center;
	color: #8e5e43;
}
.online-reward img {
	width: 56px;
	height: 56px;
	object-fit: contain;
}
.online-members {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	margin: 0;
	padding: 0;
	list-style: none;
}
.room-head {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 12px;
}
.room-title {
	font-size: 18px;
}
.room-id {
	display: flex;
	align-items: center;
	gap: 6px;
}
.room-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	padding: 8px 10px;
	border-radius: 6px;
	background: #fff3dd;
}
.room-members {
	display: flex;
	flex-direction: column;
	gap: 6px;
	margin: 0;
	padding: 0;
	list-style: none;
}
.room-member {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 10px;
	border-radius: 6px;
	background: #fff3dd;
	font-size: 14px;
}
.room-member.is-offline {
	opacity: 0.55;
}
.room-crown {
	width: 22px;
	text-align: center;
}
.room-name {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.room-name em {
	margin-left: 4px;
	font-style: normal;
	opacity: 0.7;
}
.icon-btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 28px;
	height: 28px;
	padding: 0;
	border: 0;
	border-radius: 50%;
	background: transparent;
	color: #8e5e43;
	cursor: pointer;
}
.icon-btn:hover {
	background: #f7dcb4;
}
.icon-btn.is-off {
	opacity: 0.5;
}
.room-transfer {
	height: 28px;
	padding: 0 12px;
	font-size: 13px;
}
.online-members li {
	padding: 2px 8px;
	border-radius: 10px;
	background: #fff3dd;
	font-size: 12px;
}
</style>
