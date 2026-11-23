import { onBeforeUnmount, ref, watch, type Ref } from "vue"
import type { CollectionState, HandSide } from "../../shared/types"

/** Body layer index: 1 = idle, 2 = left hand down, 3 = right hand down, 4 = both hands down. */
export type BodyAction = 1 | 2 | 3 | 4

const TAP_DURATION_MS = 150

/** Drives the pet's arm animation from input events, honouring hand mode and hold settings. */
export function useHandAction(state: Ref<CollectionState | null>) {
	const action = ref<BodyAction>(1)
	const heldKeys = new Map<string, BodyAction>()
	let alternateHand: HandSide = "left"
	let resetTimer: number | undefined

	const settings = () => state.value?.settings

	function stopTimer() {
		window.clearTimeout(resetTimer)
		resetTimer = undefined
	}

	function resolve(inputSide: HandSide): BodyAction {
		let side = inputSide
		switch (settings()?.handAnimation ?? "adaptive") {
			case "alternate":
				side = alternateHand
				alternateHand = side === "left" ? "right" : "left"
				break
			case "random":
				side = Math.random() < 0.5 ? "left" : "right"
				break
			case "right":
			case "left":
				side = settings().handAnimation as HandSide
				break
		}
		return side === "left" ? 2 : 3
	}

	/** A short tap animation that returns to idle on its own. */
	function tap(side: HandSide) {
		action.value = resolve(side)
		stopTimer()
		resetTimer = window.setTimeout(() => (action.value = 1), TAP_DURATION_MS)
	}

	function press(key: string, side: HandSide) {
		if (!settings()?.holdAnimation) {
			tap(side)
			return
		}
		heldKeys.delete(key)
		heldKeys.set(key, resolve(side))
		stopTimer()
		action.value = heldAction()
	}

	/** On release the keys still held decide the pose again. */
	function release(key: string) {
		const wasHeld = heldKeys.delete(key)
		if (!settings()?.holdAnimation || !wasHeld) return
		stopTimer()
		action.value = heldAction()
	}

	/**
	 * The pose for the keys being held: in adaptive mode, keys held on both sides put both hands down;
	 * otherwise the most recently pressed key's hand.
	 */
	function heldAction(): BodyAction {
		const hands = [...heldKeys.values()]
		if (settings()?.handAnimation === "adaptive" && hands.includes(2) && hands.includes(3)) return 4
		return hands.at(-1) ?? 1
	}

	watch(
		() => Boolean(settings()?.holdAnimation && settings()?.inputEnabled),
		holding => {
			if (holding) return
			heldKeys.clear()
			stopTimer()
			action.value = 1
		},
	)

	onBeforeUnmount(stopTimer)

	return { action, tap, press, release }
}
