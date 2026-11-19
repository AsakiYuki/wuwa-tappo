<script setup lang="ts">
import { computed } from "vue"
import { assetPath } from "../../../shared/assets"
import { getItem } from "../../store"

const props = defineProps<{ characterId: string; accessoryId: string }>()

const character = computed(() => getItem(props.characterId))
const accessory = computed(() => getItem(props.accessoryId))
const accessoryStyle = computed(() => ({
	transform: `translate(${(character.value?.offsetX || 0) * 0.5}px, ${(character.value?.offsetY || 0) * 0.5}px)`,
}))
</script>

<template>
	<div class="preset-img">
		<template v-if="character">
			<img :src="assetPath(character.layers.head1)" draggable="false" />
			<img :src="assetPath(character.layers.body1)" draggable="false" />
			<img v-if="accessory" :src="assetPath(accessory.image)" :style="accessoryStyle" draggable="false" />
		</template>
	</div>
</template>
