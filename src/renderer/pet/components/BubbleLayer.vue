<script setup lang="ts">
import { computed } from "vue"
import type { Bubble } from "../composables/useBubbles"
import { bubbleTextColor } from "../lib/color"

const props = defineProps<{ bubbles: Bubble[]; color: string }>()
defineEmits<{ done: [id: number] }>()

const layerStyle = computed(() => ({
	"--bubble-color": props.color,
	"--bubble-text-color": bubbleTextColor(props.color),
}))
</script>

<template>
	<div id="bubble" class="local-emotion-bubble-layer" :style="layerStyle">
		<template v-for="bubble in bubbles" :key="bubble.id">
			<div
				v-if="bubble.kind === 'emote'"
				class="local-emotion-bubble"
				:data-emote="bubble.value"
				:style="bubble.style"
				@animationend.self="$emit('done', bubble.id)"
			>
				<img class="local-emotion-bubble__img" :src="bubble.image" :alt="bubble.alt" />
			</div>
			<div
				v-else
				class="local-key-bubble"
				:data-label="bubble.value"
				:style="bubble.style"
				@animationend.self="$emit('done', bubble.id)"
			>
				{{ bubble.value }}
			</div>
		</template>
	</div>
</template>
