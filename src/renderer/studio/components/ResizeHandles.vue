<script setup lang="ts">
import { RESIZE_EDGES } from "../../../domain/types"
import type { ResizeEdge } from "../../shared/types"

/** Frameless windows need their own edge handles; each reports pointer deltas to the main process. */
let drag: { edge: ResizeEdge; x: number; y: number } | null = null

function start(edge: ResizeEdge, event: PointerEvent) {
	if (event.button !== 0) return
	event.preventDefault()
	drag = { edge, x: event.screenX, y: event.screenY }
	;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function move(event: PointerEvent) {
	if (!drag) return
	const dx = event.screenX - drag.x
	const dy = event.screenY - drag.y
	drag.x = event.screenX
	drag.y = event.screenY
	window.petAPI.resizeWindow(drag.edge, dx, dy)
}

function stop() {
	drag = null
}
</script>

<template>
	<div id="resizeHandles">
		<div
			v-for="edge in RESIZE_EDGES"
			:key="edge"
			class="resize-handle"
			:class="`resize-${edge}`"
			@pointerdown="start(edge, $event)"
			@pointermove="move"
			@pointerup="stop"
			@pointercancel="stop"
		></div>
	</div>
</template>
