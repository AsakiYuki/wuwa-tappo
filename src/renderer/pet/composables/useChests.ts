import { computed, onBeforeUnmount, onMounted, ref, type Ref } from "vue"
import type { ChestClock, ChestReward, ChestSide, CommandResult, PetAPI } from "../../shared/types"

/*
 * The two desktop chests of online mode (the original's countdown and chest bubbles beside the pet).
 * The app says how long each chest has left (event `chest-clock`, also on request); this counts down
 * between those messages. See src-tauri/src/online/chest.rs for where the numbers come from.
 */

const TICK_MS = 1000
export const CHEST_SIDES: readonly ChestSide[] = ["left", "right"]

export interface ChestBubble {
	side: ChestSide
	ready: boolean
	/** mm:ss until it is ready; empty once it is. */
	text: string
}

/** Seconds as the original shows them: `01:12`. */
export function clockText(totalMs: number): string {
	const seconds = Math.max(0, Math.ceil(totalMs / 1000))
	const pad = (value: number) => String(value).padStart(2, "0")
	return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`
}

export function useChests(
	api: PetAPI,
	showCountdown: Ref<boolean>,
	report: (message: string) => void,
) {
	const clock = ref<ChestClock | null>(null)
	const receivedAt = ref(performance.now())
	const now = ref(performance.now())
	const busy = ref(false)
	let timer: number | undefined

	function adopt(next: ChestClock | null) {
		clock.value = next
		receivedAt.value = performance.now()
		now.value = receivedAt.value
	}

	const bubbles = computed<ChestBubble[]>(() => {
		const current = clock.value
		// Without enough clicks the original shows nothing at all.
		if (!current || !current.loggedIn || !current.eligible) return []
		const elapsed = now.value - receivedAt.value
		const result: ChestBubble[] = []
		for (const side of CHEST_SIDES) {
			const total = current[side]
			if (total === null || total === undefined) continue
			const remaining = Math.max(0, total - elapsed)
			if (remaining <= 0) result.push({ side, ready: true, text: "" })
			else if (showCountdown.value) result.push({ side, ready: false, text: clockText(remaining) })
		}
		return result
	})

	async function open(side: ChestSide) {
		if (busy.value) return
		busy.value = true
		try {
			const reply: CommandResult<ChestReward> = await api.command("chest", side)
			if (reply.ok && reply.result) report(`+ ${reply.result.name}`)
			else report(reply.error ?? "The chest could not be opened")
		} finally {
			busy.value = false
		}
	}

	onMounted(() => {
		api.onChestClock(adopt)
		void api.command<ChestClock>("chest-clock").then(reply => {
			if (reply.ok && reply.result) adopt(reply.result)
		})
		timer = window.setInterval(() => (now.value = performance.now()), TICK_MS)
	})
	onBeforeUnmount(() => window.clearInterval(timer))

	return { bubbles, open, busy }
}
