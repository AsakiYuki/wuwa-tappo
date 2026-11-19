<script setup lang="ts">
import { computed } from "vue"
import { assetPath, itemName } from "../../../shared/assets"
import { MAX_EMOTES, emotePickerItem, getItem, replaceEmote, state } from "../../store"
import { toast } from "../../toast"
import ModalDialog from "../ModalDialog.vue"

/** Shown when equipping an emote while all five slots are full. */
const open = computed({
	get: () => emotePickerItem.value !== null,
	set: value => {
		if (!value) emotePickerItem.value = null
	},
})

const slots = computed(() =>
	Array.from({ length: MAX_EMOTES }, (_, slot) => ({ slot, current: getItem(state.value?.emotes[slot]) })),
)

async function replace(slot: number) {
	const item = emotePickerItem.value
	if (item && (await replaceEmote(item, slot))) {
		emotePickerItem.value = null
		toast(`Replaced emote ${slot + 1}`)
	}
}
</script>

<template>
	<ModalDialog id="emotePicker" v-model:open="open">
		<button id="closeEmotePicker" class="popup-close" title="Cancel" @click="open = false"></button>
		<h2 id="emotePickerTitle">
			{{ emotePickerItem ? `Equip ${itemName(emotePickerItem)}` : "Replace Which Emote?" }}
		</h2>
		<p id="emotePickerTip" class="emote-picker-tip">Click a slot below to equip the selected emote.</p>
		<div id="emoteSlots">
			<button
				v-for="{ slot, current } in slots"
				:key="slot"
				class="emote-replace-slot"
				:data-slot="slot"
				@click="replace(slot)"
			>
				<img v-if="current" :src="assetPath(current.image)" />
				<span>{{ slot + 1 }} · {{ current ? itemName(current) : "Empty Slot" }}</span>
			</button>
		</div>
	</ModalDialog>
</template>
