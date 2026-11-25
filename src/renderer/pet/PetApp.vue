<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef } from "vue"
import { assetPath } from "../shared/assets"
import type { CatalogItem, CollectionState, CursorMessage, InputMessage } from "../shared/types"
import BubbleLayer from "./components/BubbleLayer.vue"
import EmoteMenu from "./components/EmoteMenu.vue"
import PetKeyboard from "./components/PetKeyboard.vue"
import { useBubbles } from "./composables/useBubbles"
import { useCounter } from "./composables/useCounter"
import { useHandAction } from "./composables/useHandAction"
import { usePetDrag } from "./composables/usePetDrag"
import { useHoverArea } from "./composables/useHoverArea"
import { keyLabel } from "./lib/keys"

const BLINK_INTERVAL_MS = 4200
const BLINK_DURATION_MS = 180
const MENU_CLOSE_DELAY_MS = 160
/** A pet click this soon after a hooked mouse press was already animated by the input hook. */
const HOOK_CLICK_WINDOW_MS = 150
const DEFAULT_BUBBLE_COLOR = "#ffd26f"

const api = window.petAPI
const state = shallowRef<CollectionState | null>(null)
const items = shallowRef<CatalogItem[]>([])
const itemMap = computed(() => new Map(items.value.map(item => [item.id, item])))
const settings = computed(() => state.value?.settings)

const face = ref<1 | 2>(1)
const activeKeys = shallowRef<ReadonlySet<string>>(new Set())
const menuOpen = ref(false)
const menuPinned = ref(false)
const cursorHovered = ref(false)
/** Whether the app is sending the cursor position (then it, not `:hover`, drives hover-fade). */
const cursorFed = ref(false)
const inputStatusTitle = ref("")
const content = useTemplateRef<HTMLElement>("content")
useHoverArea(content, area => api.setHoverArea(area))
let lastMouseInputAt = 0

const counter = useCounter(state)
const hand = useHandAction(state)
const { bubbles, pushEmote, pushKey, remove: removeBubble } = useBubbles(() => settings.value?.bubbleLifetime ?? 1)
const drag = usePetDrag(state, pressedAt => {
	const handledByInputHook = settings.value.inputEnabled && lastMouseInputAt >= pressedAt - HOOK_CLICK_WINDOW_MS
	if (!handledByInputHook) hand.tap("left")
	void api.command("tap")
})

const character = computed(() => (state.value ? itemMap.value.get(state.value.character) : undefined))
const accessory = computed(() => (state.value ? itemMap.value.get(state.value.accessory) : undefined))
const headImage = computed(() => character.value?.layers?.[`head${face.value}`] ?? character.value?.image)
// A catalog without the both-hands pose (body4) falls back to the right hand's.
const bodyImage = computed(() => {
	const layers = character.value?.layers
	return (
		layers?.[`body${hand.action.value}`] ??
		(hand.action.value === 4 ? layers?.body3 : undefined) ??
		character.value?.image
	)
})

const rootClass = computed(() => ({
	"hover-fade": settings.value.hoverFade,
	// With passthrough the page gets no pointer events, so `:hover` could stick (no leave event
	// arrives); the cursor position fed from the app decides instead. The app may also feed it
	// without passthrough (KDE Wayland), where it is more reliable than `:hover`.
	"cursor-fed": settings.value.passthrough || cursorFed.value,
	"hide-keyboard": !settings.value.showKeyboard,
	"counter-left": settings.value.counterLeft,
}))

function handleInput(event: InputMessage) {
	if (event.countedTap) counter.recordTap(event.key)
	if (state.value) {
		state.value = {
			...state.value,
			count: event.count,
			totalCount: event.totalCount,
			dailyCount: event.dailyCount,
		}
	}
	const nextKeys = new Set(activeKeys.value)
	if (event.down) nextKeys.add(event.key)
	else nextKeys.delete(event.key)
	activeKeys.value = nextKeys

	if (!event.down) {
		hand.release(event.key)
		return
	}
	const isPointer = event.key.startsWith("Mouse") || event.key === "Touchpad"
	if (isPointer) lastMouseInputAt = Date.now()
	if (isPointer ? settings.value?.showMouseBubbles : settings.value?.showPressedKeys)
		pushKey(keyLabel(event.key, settings.value))
	hand.press(event.key, event.side)
}

function handleCursor(cursor: CursorMessage | null) {
	cursorFed.value = cursor !== null
	if (typeof cursor?.hovered === "boolean") {
		cursorHovered.value = cursor.hovered
		return
	}
	const rect = content.value?.getBoundingClientRect()
	cursorHovered.value = Boolean(
		cursor &&
		rect &&
		cursor.x >= rect.left &&
		cursor.x < rect.right &&
		cursor.y >= rect.top &&
		cursor.y < rect.bottom,
	)
}

let menuTimer: number | undefined
function openMenu() {
	window.clearTimeout(menuTimer)
	// The pet cannot be clicked through passthrough, so the menu would only get in the way. macOS
	// still sends pointerenter to a window that ignores the mouse.
	if (settings.value?.passthrough) return
	menuOpen.value = true
}
function scheduleMenuClose() {
	menuTimer = window.setTimeout(() => {
		if (!menuPinned.value) menuOpen.value = false
	}, MENU_CLOSE_DELAY_MS)
}
function toggleMenuPin() {
	menuPinned.value = !menuPinned.value
	menuOpen.value = menuPinned.value
}

let blinkTimer: number | undefined
onMounted(() => {
	api.onState(next => (state.value = next))
	api.onInput(handleInput)
	api.onCursor(handleCursor)
	api.onEmote(id => {
		const emote = itemMap.value.get(id)
		if (emote) pushEmote(emote)
	})
	api.onStatus(status => {
		inputStatusTitle.value = status.hook + (status.warning ? ` · ${status.warning}` : "")
	})
	void api.init().then(payload => {
		items.value = payload.items
		state.value = payload.state
	})
	blinkTimer = window.setInterval(() => {
		face.value = 2
		window.setTimeout(() => (face.value = 1), BLINK_DURATION_MS)
	}, BLINK_INTERVAL_MS)
})

onBeforeUnmount(() => {
	window.clearInterval(blinkTimer)
	window.clearTimeout(menuTimer)
})
</script>

<template>
	<main v-if="!state" id="petRoot" />
	<main
		v-else
		id="petRoot"
		:class="rootClass"
		:style="{ transform: `scale(${settings.scale})`, opacity: settings.opacity }"
		@pointerdown="drag.onPointerDown"
		@pointermove="drag.onPointerMove"
		@pointerup="drag.onPointerUp"
		@pointercancel="drag.onPointerUp"
	>
		<div
			id="petContent"
			ref="content"
			:class="{ 'cursor-hovered': cursorHovered }"
			@pointerenter="openMenu"
			@pointerleave="scheduleMenuClose"
		>
			<div id="stage" title="Drag Pet">
				<img id="head" :src="assetPath(headImage)" draggable="false" />
				<img id="body" :src="assetPath(bodyImage)" draggable="false" />
				<img
					v-if="accessory"
					id="accessory"
					:src="assetPath(accessory.image)"
					:style="{ transform: `translate(${character?.offsetX ?? 0}px, ${character?.offsetY ?? 0}px)` }"
					draggable="false"
				/>
				<BubbleLayer
					:bubbles="bubbles"
					:color="settings.bubbleColor ?? DEFAULT_BUBBLE_COLOR"
					@done="removeBubble"
				/>
			</div>
			<div id="petName" hidden>{{ character?.name ?? "" }}</div>
			<EmoteMenu
				:emote-ids="state.emotes"
				:item-map="itemMap"
				:open="menuOpen && !settings.passthrough"
				@play="id => api.command('emote', id)"
			/>
			<section class="desk">
				<PetKeyboard :active-keys="activeKeys" :highlight="settings.showPressedKeys" />
				<div class="pet-info">
					<div id="counter" class="text" title="Toggle Emote Menu" @click="toggleMenuPin">
						{{ counter.text.value }}
					</div>
				</div>
				<div class="pet-toolbar">
					<button
						v-if="settings.showChest"
						id="openChest"
						:title="settings.onlineMode ? 'Online Chests' : 'Unlimited Chests'"
						@click="api.command('open', settings.onlineMode ? 'online' : 'draw')"
					/>
					<button id="openStudio" class="settings-btn" title="Open Studio" @click="api.command('open')" />
				</div>
			</section>
			<span id="inputStatus" hidden :title="inputStatusTitle">
				{{ settings.inputEnabled ? "● Live Mapping" : "○ Input Paused" }}
			</span>
		</div>
	</main>
</template>
