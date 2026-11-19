<script setup lang="ts">
import { computed } from "vue"
import { isMac, itemName } from "../../shared/assets"
import type { CatalogItem } from "../../shared/types"
import { emotionMotion } from "../lib/emotion-motion"
import EmoteDot from "./EmoteDot.vue"

const props = defineProps<{
	emoteIds: string[]
	itemMap: ReadonlyMap<string, CatalogItem>
	open: boolean
}>()
defineEmits<{ play: [id: string] }>()

const shortcutPrefix = isMac ? "Control+Option+" : "Ctrl+Alt+"
const emotes = computed(() =>
	props.emoteIds.map(id => props.itemMap.get(id)).filter((emote): emote is CatalogItem => Boolean(emote)),
)
</script>

<template>
	<div
		id="emoteBar"
		class="emotion-menu"
		:class="{ 'emotion-menu--open': open, 'emotion-menu--reduce-motion': emotionMotion.reduce }"
	>
		<div v-for="(emote, index) in emotes" :key="emote.id" class="emotion-dot-slot" :style="{ '--fan-i': index }">
			<EmoteDot
				:emote="emote"
				:title="`${itemName(emote)} · ${shortcutPrefix}${index + 1}`"
				@play="$emit('play', emote.id)"
			/>
		</div>
	</div>
</template>
