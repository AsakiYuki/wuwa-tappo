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

/** After the server answers a code request with 10031 (too many requests) the original waits this long. */
export const CODE_RATE_LIMIT_SECONDS = 900

/** The original pauses this long (its toast time) before it reopens the browser login after a refused login. */
export const LOGIN_RESTART_DELAY_MS = 3000

/**
 * Server ids as the passport's role list reports them, named as the original's role dialog does
 * (login-Dm44yW-R.js, build 1.0.5). Two ids each map to "HMT" and to "SEA" there; unknown ids show as is.
 */
export const SERVER_NAMES: Readonly<Record<string, string>> = {
	"591d6af3a3090d8ea00d8f86cf6d7501": "America",
	"6eb2a235b30d05efd77bedb5cf60999e": "Europe",
	"86d52186155b148b5c138ceb41be9650": "Asia",
	"919752ae5ea09c1ced910dd668a63ffb": "HMT",
	"10cd7254d57e58ae560b15d51e34b4c8": "SEA",
	"e2cbdad7edbf0d6adf477fce250bf0ea": "HMT",
	"237ef57ab0a8b33f31f8b51ccab6eb52": "SEA",
}

/**
 * The original's own texts for these server codes (its `code.N` dictionary, translated from Chinese by
 * hand) replace the server's message in the login flow.
 */
export const LOGIN_ERROR_TEXT: Readonly<Record<number, string>> = {
	10003: "Your login expired; log in again",
	10024: "Login failed",
	10031: "Login failed: enter the correct confirmation code or UID",
	10032: "The confirmation code could not be sent",
	10033: "Too many wrong codes: the game account is locked",
	10034: "The confirmation code has expired",
	10035: "Wrong confirmation code",
}

export const AGREEMENT_URL = "https://sdk.kurogames.com/p/agreement_public.html"
export const PRIVACY_URL = "https://sdk.kurogames.com/p/personal_privacy.html"

/** How often the page asks the app for the clicks the server has not seen, while it is open. */
export const STATUS_POLL_MS = 1500
