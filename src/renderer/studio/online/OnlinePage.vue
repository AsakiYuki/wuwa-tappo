<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue"
import type { ChestResult } from "../../../domain/online"
import { itemForAsset } from "../../../domain/online"
import { assetPath, itemName } from "../../shared/assets"
import { items, state } from "../store"
import { toast } from "../toast"
import { CHEST_PLACES, CODE_COOLDOWN_SECONDS, STATUS_POLL_MS, type ChestPlace } from "./config"
import * as session from "./session"

const props = defineProps<{ visible: boolean }>()

const uid = ref("")
const code = ref("")
const redeemCode = ref("")
const roomNumber = ref("")
const cooldown = ref(0)
const lastChest = ref<ChestResult | null>(null)

const enabled = computed(() => state.value?.settings.onlineMode === true)
const { busy, loggedIn, user, room, balance, pendingClicks, loginStage, loginRoles, loginError } = session

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

let cooldownTimer: ReturnType<typeof setInterval> | undefined
function startCooldown() {
	cooldown.value = CODE_COOLDOWN_SECONDS
	clearInterval(cooldownTimer)
	cooldownTimer = setInterval(() => {
		cooldown.value -= 1
		if (cooldown.value <= 0) clearInterval(cooldownTimer)
	}, 1000)
}

async function sendCode() {
	if (await attempt(() => session.sendCode(uid.value), "Confirmation code sent")) startCooldown()
}

async function logIn() {
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

			<div v-if="!loggedIn" class="online-card">
				<p class="online-note">
					Log in with your Kuro Games account: the login page opens in your browser and brings you back here.
				</p>
				<div v-if="loginStage === 'choose'" class="online-row">
					<button
						v-for="(role, index) in loginRoles"
						:key="`${role.serverId}-${role.playerId}`"
						class="common-btn"
						type="button"
						@click="attempt(() => session.chooseRole(index))"
					>
						{{ role.name || role.playerId }} ({{ role.serverId }})
					</button>
				</div>
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

			<form v-if="!loggedIn" class="online-card" @submit.prevent="logIn">
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
						{{ cooldown > 0 ? `Resend in ${cooldown}s` : "Send Code" }}
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
					<button class="common-btn" type="submit" :disabled="busy">Log In</button>
				</div>
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
				<div v-else class="online-card">
					<div class="online-row online-row--between">
						<strong>Room {{ room.roomNo }}</strong>
						<div class="online-row">
							<label class="online-check">
								<input
									type="checkbox"
									:checked="room.isPublic"
									:disabled="busy"
									@change="
										attempt(() =>
											session.setRoomPublic(($event.target as HTMLInputElement).checked),
										)
									"
								/>
								Public
							</label>
							<button class="common-btn" @click="session.leaveRoom()">Leave</button>
						</div>
					</div>
					<ul class="online-members">
						<li v-for="(member, index) in room.members" :key="`${member.userId}-${index}`">
							{{ member.nickname }}
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
.online-members li {
	padding: 2px 8px;
	border-radius: 10px;
	background: #fff3dd;
	font-size: 12px;
}
</style>
