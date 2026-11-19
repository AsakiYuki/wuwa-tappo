<script setup lang="ts">
import { KEYBOARD_ROWS, isKeyActive } from "../lib/keys"

const props = defineProps<{
	activeKeys: ReadonlySet<string>
	highlight: boolean
}>()

const isActive = (key: string) => props.highlight && isKeyActive(key, props.activeKeys)
</script>

<template>
	<div class="keyboard-plane">
		<div id="keyboard" class="keyboard" aria-label="42-key keyboard">
			<div v-for="(row, rowIndex) in KEYBOARD_ROWS" :key="rowIndex" class="keyrow">
				<span
					v-for="cap in row"
					:key="cap.key"
					class="key"
					:class="{ space: cap.size === 'space', wide: cap.size === 'wide', active: isActive(cap.key) }"
					:data-key="cap.key"
				>
					<span>{{ cap.label }}</span>
				</span>
			</div>
		</div>
	</div>
</template>
