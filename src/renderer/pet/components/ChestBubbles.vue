<script setup lang="ts">
import { assetPath } from "../../shared/assets"
import type { ChestSide } from "../../shared/types"
import type { ChestBubble } from "../composables/useChests"

defineProps<{ bubbles: ChestBubble[]; busy: boolean }>()
defineEmits<{ open: [side: ChestSide] }>()
</script>

<template>
	<div v-if="bubbles.length" class="chest-bubbles">
		<template v-for="bubble in bubbles" :key="bubble.side">
			<button
				v-if="bubble.ready"
				type="button"
				class="chest-bubble ready"
				:disabled="busy"
				title="Open Chest"
				@pointerdown.stop
				@click.stop="$emit('open', bubble.side)"
			>
				<img :src="assetPath('assets/ui/chest/base-gold.png')" alt="Chest" draggable="false" />
			</button>
			<div v-else class="chest-bubble countdown" title="Chest Countdown">{{ bubble.text }}</div>
		</template>
	</div>
</template>
