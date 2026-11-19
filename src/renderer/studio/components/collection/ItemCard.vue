<script setup lang="ts">
import { computed } from "vue"
import { assetPath, itemName } from "../../../shared/assets"
import type { CatalogItem } from "../../../shared/types"
import { RARITY_LABELS } from "../../lib/constants"
import { command, equipped, isAtlas, playEmote, selectItem, state } from "../../store"

const props = defineProps<{ item: CatalogItem; left: number; top: number }>()

const owned = computed(() => state.value.owned[props.item.id] || 0)
const name = computed(() => itemName(props.item))
const kind = computed(() => (props.item.type === "character" ? "character_skin" : props.item.type))
const favorite = computed(() => state.value.favorites.includes(props.item.id))

function onKeyDown(event: KeyboardEvent) {
	if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return
	event.preventDefault()
	;(event.currentTarget as HTMLElement).click()
}

/** Right-click plays an owned emote without equipping it. */
function onContextMenu(event: MouseEvent) {
	if (props.item.type !== "emote" || !owned.value) return
	event.preventDefault()
	playEmote(props.item.id)
}
</script>

<template>
	<article
		class="atlas-item item-card"
		:class="[
			`atlas-item--${kind}`,
			{ 'atlas-item--unowned': !owned, 'atlas-item--active': equipped(item) && !isAtlas },
		]"
		:data-id="item.id"
		:title="`${name} · ${RARITY_LABELS[item.rarity]}`"
		:style="{ position: 'absolute', left: `${left}px`, top: `${top}px` }"
		tabindex="0"
		@click="selectItem(item)"
		@keydown="onKeyDown"
		@contextmenu="onContextMenu"
	>
		<div class="atlas-thumb" :class="`atlas-thumb--${item.rarity}`">
			<!-- Eager loading: Chromium can leave virtualised images blank in file:// windows. -->
			<img :src="assetPath(item.thumbnail)" loading="eager" draggable="false" />
		</div>
		<div class="atlas-name">
			<div class="atlas-name-inner">{{ name }}</div>
		</div>
		<span class="atlas-type-icon" />
		<span v-if="owned > 1" class="atlas-qty">{{ owned }}</span>
		<button
			class="atlas-collect"
			:class="{ 'atlas-collect--active': favorite }"
			title="Favorite / Unfavorite"
			:aria-label="`Favorite ${name}`"
			@click.stop="command('favorite', item.id)"
		/>
	</article>
</template>
