<script setup lang="ts">
defineProps<{ title: string; titleId?: string; description?: string }>()
</script>

<template>
	<div class="setting-item" :class="{ 'has-sub': description }">
		<div>
			<div :id="titleId" class="setting-title">{{ title }}</div>
			<div v-if="description" class="setting-sub">{{ description }}</div>
		</div>
		<slot />
	</div>
</template>
