<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue"
import { assetPath } from "../shared/assets"
import type { CatalogItem } from "../shared/types"
import type { RoomEmoteEvent, RoomSocketMember } from "../../domain/types"

/*
 * The other members of the room the app is in, drawn beside the pet window. Everything arrives as
 * events from src-tauri/src/online/room.rs; the window never receives a click (it is click-through).
 */

const BLINK_INTERVAL_MS = 4200
const BLINK_DURATION_MS = 180
const EMOTE_MS = 2600
/** Pets that fit the overlay (see OVERLAY_SIZE in room.rs). */
const MAX_PETS = 6

const api = window.petAPI
const items = shallowRef<CatalogItem[]>([])
const members = shallowRef<RoomSocketMember[]>([])
const selfId = ref(0)
const face = ref<1 | 2>(1)
const emotes = ref<Record<number, { key: number; image: string }>>({})
const emoteTimers = new Map<number, number>()

const byAsset = computed(() => new Map(items.value.map(item => [`${item.type}:${item.assetId}`, item])))

interface RemotePet {
	id: number
	name: string
	head: string
	body: string
	accessory: string
	accessoryOffset: { x: number; y: number }
}

const pets = computed<RemotePet[]>(() => {
	const shown: RemotePet[] = []
	for (const member of members.value) {
		if (member.id === selfId.value || !member.online) continue
		const character = byAsset.value.get(`character:${member.characterAssetId}`)
		if (!character) continue
		const layers = character.layers ?? {}
		const hand = member.state === "left" ? 2 : member.state === "right" ? 3 : 1
		const part = member.partAssetId > 0 ? byAsset.value.get(`accessory:${member.partAssetId}`) : undefined
		shown.push({
			id: member.id,
			name: member.nickname,
			head: assetPath(layers[`head${face.value}`] ?? character.image),
			body: assetPath(layers[`body${hand}`] ?? character.image),
			accessory: part ? assetPath(part.image) : "",
			accessoryOffset: { x: character.offsetX ?? 0, y: character.offsetY ?? 0 },
		})
		if (shown.length >= MAX_PETS) break
	}
	return shown
})

function playEmote(event: RoomEmoteEvent) {
	const emote =
		typeof event.emote === "number"
			? byAsset.value.get(`emote:${event.emote}`)
			: items.value.find(item => item.type === "emote" && (item.id === event.emote || item.name === event.emote))
	if (!emote) return
	window.clearTimeout(emoteTimers.get(event.memberId))
	emotes.value = { ...emotes.value, [event.memberId]: { key: Date.now(), image: assetPath(emote.image) } }
	emoteTimers.set(
		event.memberId,
		window.setTimeout(() => {
			const { [event.memberId]: _gone, ...rest } = emotes.value
			emotes.value = rest
		}, EMOTE_MS),
	)
}

let blinkTimer: number | undefined
onMounted(() => {
	api.online.onRoomMembers(event => {
		members.value = event.members
		selfId.value = event.selfId
	})
	api.online.onRoomEmote(playEmote)
	void api.init().then(payload => (items.value = payload.items))
	blinkTimer = window.setInterval(() => {
		face.value = 2
		window.setTimeout(() => (face.value = 1), BLINK_DURATION_MS)
	}, BLINK_INTERVAL_MS)
})
onBeforeUnmount(() => {
	window.clearInterval(blinkTimer)
	emoteTimers.forEach(timer => window.clearTimeout(timer))
})
</script>

<template>
	<main id="roomRoot">
		<div v-for="pet in pets" :key="pet.id" class="remote-pet">
			<div class="remote-stage">
				<img class="remote-head" :src="pet.head" draggable="false" />
				<img class="remote-body" :src="pet.body" draggable="false" />
				<img
					v-if="pet.accessory"
					class="remote-accessory"
					:src="pet.accessory"
					:style="{ transform: `translate(${pet.accessoryOffset.x}px, ${pet.accessoryOffset.y}px)` }"
					draggable="false"
				/>
				<img
					v-if="emotes[pet.id]"
					:key="emotes[pet.id].key"
					class="remote-emote"
					:src="emotes[pet.id].image"
					draggable="false"
				/>
			</div>
			<div class="remote-name">{{ pet.name }}</div>
		</div>
	</main>
</template>
