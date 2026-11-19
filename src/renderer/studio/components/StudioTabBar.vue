<script setup lang="ts">
import type { StudioPage } from "../lib/collection"
import { command, navigate, page } from "../store"

const tabs: Array<{ page: StudioPage; icon: string; label: string }> = [
	{ page: "collection", icon: "bag", label: "Bag" },
	{ page: "atlas", icon: "atlas", label: "Atlas" },
	{ page: "synthesis", icon: "exchange", label: "Synthesis" },
	{ page: "draw", icon: "room", label: "Chests" },
	{ page: "settings", icon: "setting", label: "Settings" },
]

/** Sub-pages keep their parent tab highlighted. */
const PARENT_TAB: Partial<Record<StudioPage, StudioPage>> = {
	presets: "collection",
	"keyboard-labels": "settings",
}

const isActive = (tab: StudioPage) => page.value === tab || PARENT_TAB[page.value] === tab
</script>

<template>
	<nav class="tab-bar">
		<div class="tab-logo"></div>
		<button
			v-for="tab in tabs"
			:key="tab.page"
			class="tab-btn"
			:class="{ 'tab-btn--active': isActive(tab.page) }"
			:data-page="tab.page"
			@click="navigate(tab.page)"
		>
			<i class="tab-btn__icon" :class="`tab-btn__icon--${tab.icon}`"></i>
			<span class="tab-btn__label">{{ tab.label }}</span>
		</button>
		<button id="hidePanel" class="tab-btn" @click="command('hide')">
			<i class="tab-btn__icon tab-btn__icon--toggle"></i>
			<span class="tab-btn__label">Hide</span>
		</button>
	</nav>
</template>
