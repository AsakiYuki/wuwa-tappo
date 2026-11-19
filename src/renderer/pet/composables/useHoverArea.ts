import { onBeforeUnmount, watch, type Ref } from "vue"
import type { HoverArea } from "../../shared/types"

const round = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000

/**
 * Reports the content box to the main process as fractions of the window, so hover-fade can be
 * hit-tested outside the page (by KWin on Wayland) while mouse passthrough is on.
 */
export function useHoverArea(content: Ref<HTMLElement | null>, report: (area: HoverArea) => void) {
	let lastReported = ""

	function measure() {
		const rect = content.value?.getBoundingClientRect()
		if (!rect || !innerWidth || !innerHeight) return
		const area: HoverArea = {
			left: round(rect.left / innerWidth),
			top: round(rect.top / innerHeight),
			right: round(rect.right / innerWidth),
			bottom: round(rect.bottom / innerHeight),
		}
		const serialized = JSON.stringify(area)
		if (serialized === lastReported) return
		lastReported = serialized
		report(area)
	}

	// The window is resized when the pet's scale or keyboard visibility changes; content can resize on its own.
	const observer = new ResizeObserver(measure)
	window.addEventListener("resize", measure)
	watch(
		content,
		(element, previous) => {
			if (previous) observer.unobserve(previous)
			if (element) observer.observe(element)
			measure()
		},
		{ immediate: true },
	)

	onBeforeUnmount(() => {
		observer.disconnect()
		window.removeEventListener("resize", measure)
	})
}
