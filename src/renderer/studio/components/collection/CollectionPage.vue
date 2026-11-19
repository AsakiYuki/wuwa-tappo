<script setup lang="ts">
import { computed, nextTick, useTemplateRef, watch } from "vue"
import type { InventoryType } from "../../lib/collection"
import { RARITIES } from "../../lib/constants"
import {
	cancelReplace,
	inventoryItems,
	inventoryScrollReset,
	inventoryType,
	isAtlas,
	replaceSlot,
	setInventoryType,
	state,
} from "../../store"
import FilterBar from "./FilterBar.vue"
import InventoryGroup from "./InventoryGroup.vue"
import OutfitPreview from "./OutfitPreview.vue"
import VirtualGrid from "./VirtualGrid.vue"

/** Shared by the Bag (owned items) and Atlas (every item) tabs. */
defineProps<{ visible: boolean }>()

const typeTabs: Array<{ value: InventoryType; label: string }> = [
	{ value: "all", label: "Recent" },
	{ value: "character", label: "Characters" },
	{ value: "accessory", label: "Accessories" },
	{ value: "emote", label: "Emotes" },
]

const inventory = useTemplateRef<HTMLDivElement>("inventory")

/** The Atlas "All" tab is split into collapsible rarity groups, highest first. */
const rarityGroups = computed(() => {
	if (!isAtlas.value || inventoryType.value !== "all") return []
	return [...RARITIES]
		.reverse()
		.map(rarity => ({ rarity, items: inventoryItems.value.filter(item => item.rarity === rarity) }))
		.filter(group => group.items.length > 0)
})

watch(inventoryScrollReset, () =>
	nextTick(() => {
		if (inventory.value) inventory.value.scrollTop = 0
	}),
)
</script>

<template>
	<section id="page-collection" class="page module-block" :class="{ 'role-panel': !isAtlas }" :hidden="!visible">
		<div class="panel-content">
			<div id="currentOutfit" class="preset-content" :hidden="isAtlas">
				<OutfitPreview v-if="state" />
			</div>
			<div id="typeTabs">
				<div class="atlas-tab">
					<button
						v-for="tab in typeTabs"
						:id="tab.value === 'all' ? 'allTab' : undefined"
						:key="tab.value"
						class="atlas-tab-item"
						:class="{ selected: inventoryType === tab.value }"
						:data-type="tab.value"
						@click="setInventoryType(tab.value)"
					>
						{{ tab.value === "all" && isAtlas ? "All" : tab.label }}
					</button>
				</div>
			</div>
			<FilterBar />
			<div id="replaceBar" :hidden="replaceSlot === null">
				<span id="replaceHint">
					{{ replaceSlot === null ? "" : `Replacing emote ${replaceSlot + 1} · Select an owned emote below` }}
				</span>
				<button id="cancelReplace" class="setting-btn" @click="cancelReplace">Cancel</button>
			</div>
			<div class="atlas-content">
				<div id="inventory" ref="inventory" class="atlas-section common-scrollbar2">
					<div v-if="state" id="inventoryRoot">
						<div v-if="inventoryItems.length === 0" class="empty">No items collected yet</div>
						<template v-if="rarityGroups.length">
							<InventoryGroup
								v-for="group in rarityGroups"
								:key="group.rarity"
								:rarity="group.rarity"
								:items="group.items"
								:scroller="inventory"
							/>
						</template>
						<VirtualGrid v-else :items="inventoryItems" :scroller="inventory" />
					</div>
				</div>
			</div>
		</div>
	</section>
</template>
