<script setup lang="ts">
import { computed, ref } from "vue"
import type { CatalogItem, Rarity } from "../../../shared/types"
import { RARITY_LABELS } from "../../lib/constants"
import { state } from "../../store"
import VirtualGrid from "./VirtualGrid.vue"

const props = defineProps<{ rarity: Rarity; items: CatalogItem[]; scroller: HTMLElement | null }>()

const collapsed = ref(false)
const collected = computed(() => props.items.filter(item => state.value.owned[item.id]).length)
</script>

<template>
	<section class="atlas-group" :class="{ 'atlas-list-hidden': collapsed }">
		<button class="atlas-type" :aria-expanded="!collapsed" @click="collapsed = !collapsed">
			{{ RARITY_LABELS[rarity] }} ({{ collected }}/{{ items.length }})
		</button>
		<div class="atlas-list-wrapper">
			<VirtualGrid :items="items" :scroller="scroller" :collapsed="collapsed" />
		</div>
	</section>
</template>
