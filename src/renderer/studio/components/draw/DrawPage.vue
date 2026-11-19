<script setup lang="ts">
import { computed } from "vue"
import { assetPath, itemName } from "../../../shared/assets"
import { draw, getItem, state } from "../../store"

defineProps<{ visible: boolean }>()

const PITY_LIMIT = 50
const HISTORY_SHOWN = 20

const recentPulls = computed(() =>
	(state.value?.history ?? [])
		.slice(0, HISTORY_SHOWN)
		.map(entry => getItem(entry.id))
		.filter(item => item !== undefined),
)
</script>

<template>
	<section id="page-draw" class="page module-block" :hidden="!visible">
		<div class="panel-content draw-content">
			<div class="draw-banner">
				<img class="chest-art" src="../../../../../assets/ui/chest/base-gold.png" />
				<h2>Open Chests</h2>
				<p>Characters, Accessories, Emotes · Unlimited Draws</p>
				<div class="draw-buttons">
					<button class="common-btn" data-draw="1" @click="draw(1)">Draw 1 ∞</button>
					<button class="common-btn" data-draw="10" @click="draw(10)">Draw 10 ∞</button>
				</div>
				<p id="pity">{{ state ? `Epic pity in ${PITY_LIMIT - state.pity} pulls · Unlimited` : "" }}</p>
			</div>
			<p class="rules">
				Local rates: Common 65% · Uncommon 25% · Rare 9% · Epic 1%. Guaranteed Uncommon+ in 10-pull, Epic within
				50 pulls.
			</p>
			<div class="section-title">
				<h3>Recent Pulls</h3>
				<span id="drawTotal">{{ state ? `Total opened: ${state.draws.toLocaleString()}` : "" }}</span>
			</div>
			<div id="history" class="history">
				<img
					v-for="(item, index) in recentPulls"
					:key="`${item.id}-${index}`"
					:src="assetPath(item.thumbnail)"
					:title="itemName(item)"
					loading="eager"
					draggable="false"
				/>
			</div>
		</div>
	</section>
</template>
