<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import type { FilterKey } from "../../lib/collection"
import { RARITY_LABELS } from "../../lib/constants"
import { filterMetadata, inventoryFilters, inventoryType, setInventoryFilter } from "../../store"
import FilterSelect from "./FilterSelect.vue"

const openFilter = ref<FilterKey | null>(null)

/** Which dropdowns each item type offers. */
const specifications = computed(() => {
	const type = inventoryType.value
	const specs: Array<{ key: FilterKey; title: string; values: Record<string, string> }> = []
	if (type === "all") return specs
	if (type === "character") specs.push({ key: "series", title: "Series", values: filterMetadata.value.series })
	if (type === "character" || type === "emote") {
		const roles = filterMetadata.value.roles
		specs.push({ key: "role", title: "Role", values: type === "emote" ? { 0: "Abby", ...roles } : roles })
	}
	specs.push({ key: "rarity", title: "Rarity", values: RARITY_LABELS })
	return specs
})

function setOpen(key: FilterKey, open: boolean) {
	if (open) openFilter.value = key
	else if (openFilter.value === key) openFilter.value = null
}

function select(key: FilterKey, value: string) {
	setInventoryFilter(key, value)
	openFilter.value = null
}

const close = () => (openFilter.value = null)
const onDocumentClick = (event: MouseEvent) => {
	if (!(event.target instanceof Element) || !event.target.closest(".select-item")) close()
}
const onKeyDown = (event: KeyboardEvent) => {
	if (event.key === "Escape") close()
}

onMounted(() => {
	document.addEventListener("click", onDocumentClick)
	document.addEventListener("keydown", onKeyDown)
	window.addEventListener("resize", close)
})
onBeforeUnmount(() => {
	document.removeEventListener("click", onDocumentClick)
	document.removeEventListener("keydown", onKeyDown)
	window.removeEventListener("resize", close)
})
</script>

<template>
	<div id="filterBar" class="atlas-select">
		<FilterSelect
			v-for="spec in specifications"
			:key="spec.key"
			:filter-key="spec.key"
			:title="spec.title"
			:values="spec.values"
			:selected="inventoryFilters[spec.key]"
			:open="openFilter === spec.key"
			@update:open="setOpen(spec.key, $event)"
			@select="select(spec.key, $event)"
		/>
	</div>
</template>
