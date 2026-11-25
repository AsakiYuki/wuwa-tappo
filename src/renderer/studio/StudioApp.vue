<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import CollectionPage from "./components/collection/CollectionPage.vue"
import EmotePickerDialog from "./components/collection/EmotePickerDialog.vue"
import DrawPage from "./components/draw/DrawPage.vue"
import ResultsDialog from "./components/draw/ResultsDialog.vue"
import PresetsPage from "./components/presets/PresetsPage.vue"
import ResizeHandles from "./components/ResizeHandles.vue"
import OnlinePage from "./online/OnlinePage.vue"
import KeyboardLabelsPage from "./components/settings/KeyboardLabelsPage.vue"
import SettingsPage from "./components/settings/SettingsPage.vue"
import StudioTabBar from "./components/StudioTabBar.vue"
import SynthesisPage from "./components/synthesis/SynthesisPage.vue"
import WindowControls from "./components/WindowControls.vue"
import { STAGE_HEIGHT, STAGE_WIDTH, stageScale } from "./lib/stage"
import { connectStudio, page, state } from "./store"
import { toastMessage, toastVisible } from "./toast"

/** Pages stay mounted (only hidden) so drafts and scroll positions survive tab switches. */
const isPage = (...pages: string[]) => pages.includes(page.value)

const viewport = ref({ width: innerWidth, height: innerHeight, scale: stageScale() })
const onResize = () => (viewport.value = { width: innerWidth, height: innerHeight, scale: stageScale() })

const stageStyle = computed(() => {
	const { width, height, scale } = viewport.value
	return {
		transform: `scale(${scale})`,
		left: `${Math.max(0, (width - STAGE_WIDTH * scale) / 2)}px`,
		top: `${Math.max(0, (height - STAGE_HEIGHT * scale) / 2)}px`,
	}
})

onMounted(() => {
	window.addEventListener("resize", onResize)
	connectStudio()
})
onBeforeUnmount(() => window.removeEventListener("resize", onResize))
</script>

<template>
	<div id="replicaRoot" class="module-panel" :style="stageStyle">
		<StudioTabBar />
		<main class="module-content">
			<div class="module-content__bg"></div>
			<WindowControls />
			<CollectionPage :visible="isPage('collection', 'atlas')" />
			<DrawPage :visible="isPage('draw')" />
			<SynthesisPage :visible="isPage('synthesis')" />
			<PresetsPage :visible="isPage('presets')" />
			<template v-if="state">
				<OnlinePage :visible="isPage('online')" />
				<SettingsPage :visible="isPage('settings')" />
				<KeyboardLabelsPage :visible="isPage('keyboard-labels')" />
			</template>
		</main>
	</div>
	<div id="toast" role="status" :class="{ visible: toastVisible }">{{ toastMessage }}</div>
	<ResultsDialog />
	<EmotePickerDialog />
	<ResizeHandles />
</template>
