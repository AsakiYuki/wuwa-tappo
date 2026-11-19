import type { Ref } from "vue"
import type { CollectionState } from "../../shared/types"

interface ActiveDrag {
	pointerId: number
	x: number
	y: number
	distance: number
}

/** Pointer movement below this many pixels counts as a click on the pet. */
const CLICK_DISTANCE = 4
const NON_DRAG_TARGETS = "button, #counter, .key, .emotion-dot, #emoteBar"

/** Moves the pet window by dragging, and reports short drags as clicks. */
export function usePetDrag(state: Ref<CollectionState | null>, onClick: (pressedAt: number) => void) {
	let drag: ActiveDrag | null = null
	let pressedAt = 0

	function onPointerDown(event: PointerEvent) {
		if (!state.value || event.button !== 0 || state.value.settings.lockDrag) return
		if ((event.target as HTMLElement).closest(NON_DRAG_TARGETS)) return
		pressedAt = Date.now()
		drag = { pointerId: event.pointerId, x: event.screenX, y: event.screenY, distance: 0 }
		;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
	}

	function onPointerMove(event: PointerEvent) {
		if (!drag || event.pointerId !== drag.pointerId) return
		const dx = event.screenX - drag.x
		const dy = event.screenY - drag.y
		drag.x = event.screenX
		drag.y = event.screenY
		drag.distance += Math.abs(dx) + Math.abs(dy)
		if (dx || dy) window.petAPI.move(dx, dy)
	}

	function onPointerUp(event: PointerEvent) {
		if (!drag || event.pointerId !== drag.pointerId) return
		if (drag.distance < CLICK_DISTANCE) onClick(pressedAt)
		drag = null
		pressedAt = 0
	}

	return { onPointerDown, onPointerMove, onPointerUp }
}
