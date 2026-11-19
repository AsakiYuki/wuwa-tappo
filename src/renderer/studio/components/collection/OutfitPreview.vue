<script setup lang="ts">
import { computed } from "vue"
import { assetPath, itemName } from "../../../shared/assets"
import { MAX_EMOTES, chooseEmoteSlot, command, getItem, navigate, playEmote, replaceSlot, state } from "../../store"
import PresetThumb from "./PresetThumb.vue"

const MIN_PRESET_SLOTS = 6

const character = computed(() => getItem(state.value.character))
const accessory = computed(() => getItem(state.value.accessory))
const accessoryStyle = computed(() =>
	accessory.value
		? {
				transform: `translate(${(character.value.offsetX || 0) * 1.2}px, ${(character.value.offsetY || 0) * 1.2}px)`,
			}
		: undefined,
)

const emoteSlots = computed(() =>
	Array.from({ length: MAX_EMOTES }, (_, slot) => {
		const id = state.value.emotes[slot]
		return { slot, id, emote: getItem(id), replacing: replaceSlot.value === slot }
	}),
)

/** Saved presets followed by "add" slots, always showing at least six tiles. */
const presetSlots = computed(() => {
	const presets = state.value.presets
	return Array.from({ length: Math.max(MIN_PRESET_SLOTS, presets.length + 1) }, (_, index) => presets[index])
})

function playSlotEmote(id: string | undefined, event: MouseEvent) {
	if (!id || !getItem(id)) return
	event.preventDefault()
	playEmote(id)
}

function editPresets(event?: MouseEvent) {
	event?.preventDefault()
	navigate("presets")
}
</script>

<template>
	<template v-if="character">
		<div class="preset-preview">
			<div class="preset-preview-main">
				<div class="preset-preview-img-box">
					<div class="offline-preview">
						<img :src="assetPath(character.layers.head1)" />
						<img :src="assetPath(character.layers.body1)" />
						<img
							id="heroAccessory"
							:hidden="!accessory"
							:src="accessory ? assetPath(accessory.image) : undefined"
							:style="accessoryStyle"
						/>
					</div>
				</div>
				<div id="previewEmotes">
					<button
						v-for="{ slot, id, emote, replacing } in emoteSlots"
						:key="slot"
						class="preset-preview-emote"
						:class="[`preset-preview-emote${slot + 1}`, { 'replacing-emote': replacing }]"
						:title="emote ? `Replace emote ${slot + 1} · ${itemName(emote)}` : `Equip emote ${slot + 1}`"
						@click="chooseEmoteSlot(slot)"
						@contextmenu="playSlotEmote(id, $event)"
					>
						<div class="preset-preview-emote-img">
							<img v-if="emote" :src="assetPath(emote.image)" draggable="false" />
						</div>
						<span class="emote-change-label">{{ replacing ? "Selecting" : "Change" }}</span>
					</button>
				</div>
			</div>
		</div>
		<div class="my-preset">
			<div class="my-preset-title">My Presets</div>
			<div id="miniPresets" class="my-preset-list">
				<template v-for="(preset, index) in presetSlots" :key="preset?.id ?? `add-${index}`">
					<button
						v-if="preset"
						class="preset-item"
						:title="preset.name"
						@click="command('preset-load', preset.id)"
						@contextmenu="editPresets"
					>
						<PresetThumb :character-id="preset.character" :accessory-id="preset.accessory" />
					</button>
					<button
						v-else
						class="preset-item preset-item--add"
						title="Add Preset"
						@click="editPresets()"
					></button>
				</template>
			</div>
		</div>
	</template>
</template>
