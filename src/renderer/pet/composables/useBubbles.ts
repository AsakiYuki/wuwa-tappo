import { onBeforeUnmount, shallowRef } from "vue"
import { assetPath } from "../../shared/assets"
import type { CatalogItem } from "../../shared/types"

export interface Bubble {
	id: number
	kind: "emote" | "key"
	/** Emote id for emote bubbles, label text for key bubbles. */
	value: string
	image?: string
	alt?: string
	style: Record<string, string>
}

/** Offsets cycled through so consecutive bubbles fan out instead of stacking. */
const OFFSETS: Array<[number, number]> = [
	[-30, 10],
	[4, -6],
	[28, 12],
	[-14, 2],
	[36, 6],
	[-38, 16],
	[16, -10],
	[-6, 8],
]

const jitter = (range: number) => Math.random() * range - range / 2

/** Floating emote and key bubbles above the pet. */
export function useBubbles(lifetime: () => number) {
	const bubbles = shallowRef<Bubble[]>([])
	const timers = new Set<number>()
	let nextId = 0
	let offsetIndex = 0

	function remove(id: number) {
		bubbles.value = bubbles.value.filter(bubble => bubble.id !== id)
	}

	function add(bubble: Omit<Bubble, "id" | "style">, spreadX: number, spreadY: number, extraStyle = {}) {
		const [x, y] = OFFSETS[offsetIndex++ % OFFSETS.length]
		const seconds = lifetime()
		const id = ++nextId
		bubbles.value = [
			...bubbles.value,
			{
				...bubble,
				id,
				style: {
					animationDuration: `${seconds}s`,
					"--bubble-ox": `${Math.round(x + jitter(spreadX))}px`,
					"--bubble-oy": `${Math.round(y + jitter(spreadY) - 50)}px`,
					...extraStyle,
				},
			},
		]
		// Fallback in case animationend never fires (e.g. the window is hidden).
		const timer = window.setTimeout(
			() => {
				timers.delete(timer)
				remove(id)
			},
			seconds * 1000 + 200,
		)
		timers.add(timer)
	}

	function pushEmote(item: CatalogItem) {
		add({ kind: "emote", value: item.id, image: assetPath(item.image), alt: item.name }, 10, 8)
	}

	function pushKey(label: string) {
		if (label) add({ kind: "key", value: label }, 8, 6, { "--bubble-scale": "1.2" })
	}

	onBeforeUnmount(() => timers.forEach(timer => window.clearTimeout(timer)))

	return { bubbles, pushEmote, pushKey, remove }
}
