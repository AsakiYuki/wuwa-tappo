<script setup lang="ts">
import { computed, useTemplateRef, watch } from "vue"
import type { FilterKey } from "../../lib/collection"
import { ROLE_NAMES, SERIES_NAMES } from "../../lib/constants"
import { stageScale } from "../../lib/stage"

const props = defineProps<{
	filterKey: FilterKey
	title: string
	values: Record<string, string>
	selected: string
}>()
const emit = defineEmits<{ select: [value: string] }>()
const open = defineModel<boolean>("open", { required: true })

const POPUP_GAP = 12
const VIEWPORT_MARGIN = 8

const popup = useTemplateRef<HTMLDivElement>("popup")
const list = useTemplateRef<HTMLDivElement>("list")
const trigger = useTemplateRef<HTMLButtonElement>("trigger")

function optionLabel(value: string, fallback: string) {
	if (value === "all") return "All"
	if (props.filterKey === "series" && SERIES_NAMES[value]) return SERIES_NAMES[value]
	if (props.filterKey === "role" && ROLE_NAMES[value]) return ROLE_NAMES[value]
	return fallback
}

const currentLabel = computed(() =>
	props.selected === "all" ? props.title : optionLabel(props.selected, props.values[props.selected]),
)

const options = computed(() => [
	{ value: "all", label: "All" },
	...Object.entries(props.values)
		.sort(([, left], [, right]) => String(left).localeCompare(String(right)))
		.map(([value, label]) => ({ value, label: optionLabel(value, label) })),
])

const isShown = () => popup.value?.matches(":popover-open") ?? false

/**
 * The popover lives in the top layer, outside the scaled studio stage, so it is
 * scaled and positioned by hand: below the trigger, or above it when there is more room.
 */
function show() {
	const element = popup.value
	const anchor = trigger.value?.getBoundingClientRect()
	if (!element || !anchor || isShown()) return
	const scale = stageScale()
	const width = Math.min(props.filterKey === "role" ? 560 : 240, (innerWidth - 24) / scale)
	const left = Math.max(POPUP_GAP, Math.min(anchor.left, innerWidth - width * scale - POPUP_GAP))
	const spaceBelow = innerHeight - anchor.bottom - 18
	const spaceAbove = anchor.top - 18
	const above = spaceBelow < 160 * scale && spaceAbove > spaceBelow
	const availableHeight = Math.max(70, (above ? spaceAbove : spaceBelow) / scale)

	Object.assign(element.style, {
		width: `${width}px`,
		minWidth: "0",
		transform: `scale(${scale})`,
		transformOrigin: "top left",
		left: `${left}px`,
		top: "0px",
	})
	if (list.value) list.value.style.maxHeight = `${Math.min(240, availableHeight - 16)}px`
	element.showPopover()

	const height = element.getBoundingClientRect().height
	const top = above ? anchor.top - height - POPUP_GAP : anchor.bottom + POPUP_GAP
	element.style.top = `${Math.max(VIEWPORT_MARGIN, Math.min(top, innerHeight - height - VIEWPORT_MARGIN))}px`
	element.style.setProperty("--role-popup-arrow-left", `${Math.max(20, (anchor.left - left) / scale + 35)}px`)
	element.classList.toggle("popup-above", above)
}

function hide() {
	if (isShown()) popup.value.hidePopover()
}

// Position synchronously while the trigger is still where the user clicked it.
function toggle() {
	if (open.value) {
		open.value = false
		hide()
	} else {
		open.value = true
		show()
	}
}

watch(open, value => (value ? show() : hide()))
</script>

<template>
	<div
		class="select-item"
		:class="{ 'select-item--role': filterKey === 'role', 'select-item--open': open }"
		:data-filter="filterKey"
	>
		<button ref="trigger" class="select-input" aria-haspopup="listbox" :aria-expanded="open" @click.stop="toggle">
			<span class="select-input-text">{{ currentLabel }}</span>
		</button>
		<div ref="popup" class="select-option" popover="manual" @toggle="open = isShown()">
			<div ref="list" class="select-option-list" role="listbox">
				<button
					v-for="option in options"
					:key="option.value"
					class="select-option-item"
					:class="{ 'select-option-item--active': selected === option.value }"
					:data-value="option.value"
					role="option"
					:aria-selected="selected === option.value"
					@click="emit('select', option.value)"
				>
					<span class="select-option-item-text">{{ option.label }}</span>
				</button>
			</div>
		</div>
	</div>
</template>
