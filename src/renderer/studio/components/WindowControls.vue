<script setup lang="ts">
import { command } from "../store"

const actions = [
	{ action: "smaller", label: "−", title: "Shrink Window", ariaLabel: "Shrink Window" },
	{ action: "larger", label: "＋", title: "Enlarge Window", ariaLabel: "Enlarge Window" },
	{ action: "minimize", label: "▁", title: "Minimize", ariaLabel: "Minimize" },
	{ action: "maximize", label: "□", title: "Maximize / Restore", ariaLabel: "Maximize or Restore" },
]
</script>

<template>
	<div id="panelDrag" class="panel-drag" @dblclick="command('window', 'maximize')"></div>
	<div class="window-actions">
		<button
			v-for="button in actions"
			:key="button.action"
			:data-window="button.action"
			:title="button.title"
			:aria-label="button.ariaLabel"
			@click="command('window', button.action)"
		>
			{{ button.label }}
		</button>
	</div>
	<button id="closePanel" class="panel-close" title="Close Panel" @click="command('hide')"></button>
</template>
