<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue"
import type { CatalogItem } from "../../../shared/types"
import { stageScale } from "../../lib/stage"
import ItemCard from "./ItemCard.vue"

const props = withDefaults(
	defineProps<{
		items: CatalogItem[]
		/** The scrolling ancestor whose viewport decides which rows are mounted. */
		scroller: HTMLElement | null
		collapsed?: boolean
	}>(),
	{ collapsed: false },
)

const CARD_WIDTH = 140
const ROW_HEIGHT = 159
const PADDING_X = 24
const PADDING_TOP = 12
/** Rows mounted beyond each edge of the viewport. */
const OVERSCAN_ROWS = 1

const grid = useTemplateRef<HTMLDivElement>("grid")
// DOM measurements are not reactive; bumping this re-runs the layout on scroll and resize.
const viewportVersion = ref(0)
const remeasure = () => viewportVersion.value++

const layout = computed(() => {
	void viewportVersion.value
	const width = grid.value?.clientWidth ?? props.scroller?.clientWidth ?? 0
	const columns = Math.max(1, Math.floor((width - 2 * PADDING_X + 20) / CARD_WIDTH))
	const rows = Math.ceil(props.items.length / columns)

	let firstRow = 0
	let lastRow = 1
	if (grid.value && props.scroller && !props.collapsed) {
		const scale = stageScale()
		const viewport = props.scroller.getBoundingClientRect()
		const bounds = grid.value.getBoundingClientRect()
		firstRow = Math.max(0, Math.floor((viewport.top - bounds.top) / scale / ROW_HEIGHT) - OVERSCAN_ROWS)
		lastRow = Math.ceil((viewport.bottom - bounds.top) / scale / ROW_HEIGHT) + OVERSCAN_ROWS
	}

	// Keep a focused card mounted so keyboard focus is not lost while scrolling.
	const focusedId =
		document.activeElement instanceof HTMLElement
			? document.activeElement.closest<HTMLElement>("[data-id]")?.dataset.id
			: undefined
	const firstIndex = firstRow * columns
	const lastIndex = Math.min(props.items.length, lastRow * columns)
	const cards = props.items.flatMap((item, index) =>
		(index >= firstIndex && index < lastIndex) || item.id === focusedId
			? [
					{
						item,
						left: PADDING_X + (index % columns) * CARD_WIDTH,
						top: PADDING_TOP + Math.floor(index / columns) * ROW_HEIGHT,
					},
				]
			: [],
	)
	return { height: rows ? rows * ROW_HEIGHT + 4 : 0, cards }
})

// Resizes are coalesced into the next frame; re-rendering inside the observer callback would change
// the layout it just measured and trigger "ResizeObserver loop" errors.
let resizeFrame = 0
const scheduleRemeasure = () => {
	if (!resizeFrame)
		resizeFrame = requestAnimationFrame(() => {
			resizeFrame = 0
			remeasure()
		})
}

onMounted(() => {
	window.addEventListener("resize", remeasure)
	remeasure()
})
onBeforeUnmount(() => {
	cancelAnimationFrame(resizeFrame)
	window.removeEventListener("resize", remeasure)
})

// Observe the scroller rather than the grid: the grid's own height is an output of this layout.
// This also catches a hidden page becoming visible, when every size goes from 0 to real values.
watch(
	() => props.scroller,
	(scroller, _previous, onCleanup) => {
		if (!scroller) return
		const observer = new ResizeObserver(scheduleRemeasure)
		observer.observe(scroller)
		scroller.addEventListener("scroll", remeasure, { passive: true })
		onCleanup(() => {
			observer.disconnect()
			scroller.removeEventListener("scroll", remeasure)
		})
	},
	{ immediate: true },
)
</script>

<template>
	<div ref="grid" class="atlas-list virtual-grid" :style="{ position: 'relative', height: `${layout.height}px` }">
		<ItemCard
			v-for="card in layout.cards"
			:key="card.item.id"
			:item="card.item"
			:left="card.left"
			:top="card.top"
		/>
	</div>
</template>
