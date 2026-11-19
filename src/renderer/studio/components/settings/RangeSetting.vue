<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { state, updateSettings } from "../../store"
import type { RangeSpec } from "./schema"
import SettingRow from "./SettingRow.vue"

const props = defineProps<{ spec: RangeSpec }>()

// Dragging only updates a local draft; the setting is saved once the pointer or key is released.
const draft = ref(state.value.settings[props.spec.key])
watch(
	() => state.value.settings[props.spec.key],
	value => (draft.value = value),
)

const progress = computed(() => ((draft.value - props.spec.min) / (props.spec.max - props.spec.min)) * 100)
const display = computed(() =>
	props.spec.unit === "seconds"
		? `${draft.value.toFixed(2).replace(/0$/, "")} s`
		: `${Math.round(draft.value * 100)}%`,
)

const commit = () => updateSettings({ [props.spec.key]: draft.value })
</script>

<template>
	<SettingRow :title="spec.title">
		<div class="setting-content">
			<input
				class="setting-range"
				:data-setting="spec.key"
				:aria-label="spec.title"
				type="range"
				:min="spec.min"
				:max="spec.max"
				:step="spec.step"
				:value="draft"
				:style="{ '--range-progress': `${progress}%` }"
				@input="draft = Number(($event.target as HTMLInputElement).value)"
				@pointerup="commit"
				@keyup="commit"
			/>
			<span :id="`${spec.key}Value`" class="setting-value">{{ display }}</span>
		</div>
	</SettingRow>
</template>
