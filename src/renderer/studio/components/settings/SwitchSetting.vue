<script setup lang="ts">
import { state, updateSettings } from "../../store"
import type { SwitchSpec } from "./schema"
import SettingRow from "./SettingRow.vue"

const props = defineProps<{ spec: SwitchSpec }>()

async function onChange(event: Event) {
	const input = event.target as HTMLInputElement
	await updateSettings({ [props.spec.key]: input.checked })
	// A rejected change (e.g. auto-start in a dev build) must not leave the switch flipped.
	input.checked = state.value.settings[props.spec.key]
}
</script>

<template>
	<SettingRow :title="spec.title" :description="spec.description">
		<label class="setting-switch">
			<input
				:data-setting="spec.key"
				type="checkbox"
				:aria-label="spec.title"
				:checked="state.settings[spec.key]"
				@change="onChange"
			/>
			<span class="setting-slider" />
		</label>
	</SettingRow>
</template>
