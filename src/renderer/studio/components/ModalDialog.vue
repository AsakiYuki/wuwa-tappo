<script setup lang="ts">
import { onMounted, useTemplateRef, watch } from "vue"

/** A native modal <dialog> whose visibility follows `v-model:open`. */
const open = defineModel<boolean>("open", { required: true })
const dialog = useTemplateRef<HTMLDialogElement>("dialog")

function sync(shouldOpen: boolean) {
	const element = dialog.value
	if (!element) return
	if (shouldOpen && !element.open) element.showModal()
	if (!shouldOpen && element.open) element.close()
}

/** Escape closes the dialog natively; mirror that into the model. The event is async, so ignore it after a reopen. */
function onClose() {
	if (!dialog.value?.open) open.value = false
}

onMounted(() => sync(open.value))
watch(open, sync, { flush: "post" })
</script>

<template>
	<dialog ref="dialog" @close="onClose">
		<slot />
	</dialog>
</template>
