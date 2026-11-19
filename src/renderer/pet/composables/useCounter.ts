import { computed, onBeforeUnmount, reactive, type Ref } from "vue"
import type { CollectionState } from "../../shared/types"

const CPS_TOKENS = ["CPS_ALL", "LMB_CPS", "MMB_CPS", "RMB_CPS"] as const
type CpsToken = (typeof CPS_TOKENS)[number]
type CounterToken = CpsToken | "CPS" | "DAY_COUNT" | "TOTAL_COUNT"

const TOKEN_PATTERN = /<(CPS|CPS_ALL|LMB_CPS|MMB_CPS|RMB_CPS|DAY_COUNT|TOTAL_COUNT)>/g
const BUTTON_TOKENS: Record<string, CpsToken> = {
	MouseLeft: "LMB_CPS",
	MouseMiddle: "MMB_CPS",
	MouseRight: "RMB_CPS",
}
const DEFAULT_FORMAT = "<CPS> / <DAY_COUNT>"
const WINDOW_MS = 1000

/** Clicks-per-second tracking and the formatted counter text shown under the pet. */
export function useCounter(state: Ref<CollectionState | null>) {
	const cps = reactive<Record<CpsToken, number>>({ CPS_ALL: 0, LMB_CPS: 0, MMB_CPS: 0, RMB_CPS: 0 })
	const tapTimes: Record<CpsToken, number[]> = { CPS_ALL: [], LMB_CPS: [], MMB_CPS: [], RMB_CPS: [] }
	let expiryTimer: number | undefined

	function refresh() {
		const now = Date.now()
		let nextExpiry = Number.POSITIVE_INFINITY
		for (const token of CPS_TOKENS) {
			const times = tapTimes[token].filter(timestamp => timestamp > now - WINDOW_MS)
			tapTimes[token] = times
			cps[token] = times.length
			if (times.length) nextExpiry = Math.min(nextExpiry, times[0] + WINDOW_MS)
		}
		window.clearTimeout(expiryTimer)
		if (Number.isFinite(nextExpiry)) expiryTimer = window.setTimeout(refresh, Math.max(0, nextExpiry - Date.now()))
	}

	function recordTap(key: string) {
		const now = Date.now()
		tapTimes.CPS_ALL.push(now)
		const token = BUTTON_TOKENS[key]
		if (token) tapTimes[token].push(now)
		refresh()
	}

	const text = computed(() => {
		const values: Record<CounterToken, number> = {
			...cps,
			CPS: cps.CPS_ALL,
			DAY_COUNT: state.value?.dailyCount ?? 0,
			TOTAL_COUNT: state.value?.totalCount ?? 0,
		}
		const format = state.value?.settings.counterFormat ?? DEFAULT_FORMAT
		return format.replace(TOKEN_PATTERN, token => values[token.slice(1, -1) as CounterToken].toLocaleString())
	})

	onBeforeUnmount(() => window.clearTimeout(expiryTimer))

	return { text, recordTap }
}
