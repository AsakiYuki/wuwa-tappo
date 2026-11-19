<script setup lang="ts">
import { computed } from "vue"
import { assetPath, itemName } from "../../../shared/assets"
import type { CatalogItem } from "../../../shared/types"
import { RARITY_LABELS } from "../../lib/constants"
import { command, draw, drawing, getItem, lastDrawCount, results } from "../../store"
import { toast } from "../../toast"
import ModalDialog from "../ModalDialog.vue"

/** Items obtained from a draw or a synthesis. */
const open = computed({
	get: () => results.value !== null,
	set: value => {
		if (!value) results.value = null
	},
})

const cards = computed(() =>
	(results.value?.results ?? []).flatMap((result, index) => {
		const item = getItem(result.id)
		return item ? [{ key: `${result.id}-${index}`, item, fresh: result.fresh, index }] : []
	}),
)

const cardKind = (item: CatalogItem) => (item.type === "character" ? "character_skin" : item.type)

async function equip(item: CatalogItem) {
	if ((await command("equip", item.id)).ok) toast(`Equipped ${itemName(item)}`)
}
</script>

<template>
	<ModalDialog id="results" v-model:open="open">
		<button id="closeResults" class="popup-close" title="Close" @click="open = false" />
		<template v-if="results">
			<h2 id="resultTitle">{{ results.source === "draw" ? "Items Obtained" : "Synthesis Successful" }}</h2>
			<div id="resultGrid" class="result-grid" :class="{ single: results.results.length === 1 }">
				<article
					v-for="card in cards"
					:key="card.key"
					class="result-card"
					:style="{ animationDelay: `${card.index * 0.04}s` }"
				>
					<article class="atlas-item item-card" :class="`atlas-item--${cardKind(card.item)}`">
						<div class="atlas-thumb" :class="`atlas-thumb--${card.item.rarity}`">
							<img :src="assetPath(card.item.thumbnail)" draggable="false" />
						</div>
						<div class="atlas-name">
							<div class="atlas-name-inner">{{ itemName(card.item) }}</div>
						</div>
						<span class="atlas-type-icon" />
					</article>
					<p class="result-quality">{{ RARITY_LABELS[card.item.rarity] }}</p>
					<span v-if="card.fresh" class="new">NEW</span>
					<button v-if="card.item.type !== 'emote'" class="common-btn" @click="equip(card.item)">
						Equip
					</button>
				</article>
			</div>
			<div class="result-footer">
				<p>Saved to inventory</p>
				<button
					v-if="results.source === 'draw'"
					id="drawAgain"
					class="common-btn"
					:disabled="drawing"
					@click="draw(lastDrawCount)"
				>
					{{ lastDrawCount === 10 ? "Draw 10 Again ∞" : "Draw 1 Again ∞" }}
				</button>
			</div>
		</template>
	</ModalDialog>
</template>
