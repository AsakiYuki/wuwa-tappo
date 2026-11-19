<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef } from "vue"
import { assetPath } from "../../shared/assets"
import type { CatalogItem } from "../../shared/types"
import { emotionMotion } from "../lib/emotion-motion"

defineProps<{ emote: CatalogItem; title: string }>()
defineEmits<{ play: [] }>()

const button = useTemplateRef<HTMLButtonElement>("button")
const image = useTemplateRef<HTMLImageElement>("image")
let unbind: (() => void) | undefined

onMounted(() => {
	unbind = emotionMotion.bind(button.value!, image.value!)
})
onBeforeUnmount(() => unbind?.())
</script>

<template>
	<button ref="button" class="emotion-dot" :title="title" @click.stop="$emit('play')">
		<img ref="image" class="emotion-img" :src="assetPath(emote.image)" draggable="false" />
	</button>
</template>
