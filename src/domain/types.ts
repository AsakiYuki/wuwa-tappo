export const RARITIES = ["common", "uncommon", "rare", "epic"] as const

export type Rarity = (typeof RARITIES)[number]
export type ItemType = "character" | "accessory" | "emote"
export type SynthesisMode = "same" | "upgrade"

export interface CatalogItem {
	id: string
	type: ItemType
	rarity: Rarity
	assetId: number
	name: string
	image: string
	thumbnail: string
	roleId?: number
	code?: string
	starter?: boolean
	offsetX?: number
	offsetY?: number
	layers?: Record<string, string>
}

export interface CatalogFilters {
	series: Record<string, string>
	roles: Record<string, string>
}

export interface Catalog {
	items: CatalogItem[]
	filters: CatalogFilters
}

export interface PetPosition {
	x: number
	y: number
}

export type HandAnimationMode = "adaptive" | "alternate" | "random" | "right" | "left"
export type ControllerStyle = "xbox" | "ps"

export interface Settings {
	scale: number
	opacity: number
	alwaysOnTop: boolean
	passthrough: boolean
	inputEnabled: boolean
	touchpadInput: boolean
	autoStart: boolean
	/** Talk to the Kuro Games server (see src/domain/online.ts). Off keeps the app fully offline. */
	onlineMode: boolean
	monitor: number
	lockDrag: boolean
	hoverFade: boolean
	showChest: boolean
	showKeyboard: boolean
	autoEmote: boolean
	showPressedKeys: boolean
	showMouseBubbles: boolean
	counterLeft: boolean
	counterFormat: string
	counterLimit: number | null
	bubbleLifetime: number
	bubbleColor: string
	controllerStyle: ControllerStyle
	keyLabels: Record<string, string>
	holdAnimation: boolean
	handAnimation: HandAnimationMode
	petPosition: PetPosition | null
}

export interface Preset {
	id: string
	name: string
	character: string
	accessory: string
	emotes: string[]
}

export interface HistoryEntry {
	id: string
	fresh: boolean
	source: "draw" | "synthesis"
	at: number
}

export interface CollectionState {
	version: 2
	owned: Record<string, number>
	favorites: string[]
	presets: Preset[]
	character: string
	accessory: string
	emotes: string[]
	count: number
	totalCount: number
	dailyCount: number
	dailyCountDate: string
	draws: number
	pity: number
	history: HistoryEntry[]
	settings: Settings
}

export type RawCollection = Partial<Omit<CollectionState, "version">> & {
	version?: number
}

export interface SynthesisOptions {
	type?: ItemType
	mode?: SynthesisMode
}

/* ------------------------------------------------------------------ */
/* IPC contract between the app (src-tauri) and its pages.             */
/* ------------------------------------------------------------------ */

export type HandSide = "left" | "right"
export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"
export const RESIZE_EDGES: readonly ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"]

export interface InputMessage {
	key: string
	down: boolean
	side: HandSide
	count: number
	totalCount: number
	dailyCount: number
	countedTap: boolean
	serial: number
}

export interface AppStatus {
	hook: string
	warning?: string
}

export interface MonitorInfo {
	id: number
	label: string
}

export interface InitPayload {
	state: CollectionState
	items: CatalogItem[]
	filters: CatalogFilters
	monitors: MonitorInfo[]
	status: AppStatus
}

export interface CommandResult<T = unknown> {
	ok: boolean
	result?: T
	error?: string
	warning?: string
}

/** Cursor position relative to the pet window, sent while mouse passthrough hides hover events. */
export interface CursorMessage {
	x: number
	y: number
	/**
	 * Whether the cursor is over the pet's hover area, once the app knows that area (it then only
	 * sends changes); until then the page tests `x`/`y` itself.
	 */
	hovered?: boolean | null
}

/** The pet's visible content box, as fractions (0–1) of the pet window's size. */
export interface HoverArea {
	left: number
	top: number
	right: number
	bottom: number
}

/** A reply of `petAPI.online.request`: the server's data, or the reason there is none. */
export interface OnlineReply<T = unknown> {
	ok: boolean
	data?: T
	error?: string
}

export interface OnlineStatus {
	ok: boolean
	loggedIn: boolean
	/** Taps since login that the server has not been told about. */
	pendingClicks: number
}

export interface OnlineAPI {
	request<T = unknown>(method: "GET" | "POST", endpoint: string, body?: unknown): Promise<OnlineReply<T>>
	status(): Promise<OnlineStatus>
}

export interface PetAPI {
	platform: string
	init(): Promise<InitPayload>
	command<T = unknown>(name: string, argument?: unknown): Promise<CommandResult<T>>
	onState(callback: (state: CollectionState) => void): void
	onInput(callback: (event: InputMessage) => void): void
	onEmote(callback: (id: string) => void): void
	onStatus(callback: (status: AppStatus) => void): void
	onPage(callback: (page: string) => void): void
	onCursor(callback: (cursor: CursorMessage | null) => void): void
	move(dx: number, dy: number): void
	setHoverArea(area: HoverArea): void
	resizeWindow(edge: ResizeEdge, dx: number, dy: number): void
	online: OnlineAPI
}
