/*
 * Values the original app hard-coded in its chest page (components/panel/MainPanelExchangeTab.vue,
 * decompiled build 1.0.5). Neither the `place` numbers nor the click costs have been confirmed
 * against the server; if the server rejects an open, change them here and nowhere else.
 */
export interface ChestPlace {
	place: number
	label: string
	/** Clicks charged, sent as `click_num`. */
	cost: number
	image: string
}

export const CHEST_PLACES: readonly ChestPlace[] = [
	{ place: 1, label: "Gold Chest", cost: 1000, image: "assets/ui/chest/base-gold.png" },
	{ place: 2, label: "Purple Chest", cost: 500, image: "assets/ui/chest/base-purple.png" },
	{ place: 3, label: "Blue Chest", cost: 200, image: "assets/ui/chest/base-blue.png" },
]

/** The confirmation code can be asked for again after this long (the original login form's timer). */
export const CODE_COOLDOWN_SECONDS = 60

/** How often the page asks the app for the clicks the server has not seen, while it is open. */
export const STATUS_POLL_MS = 1500
