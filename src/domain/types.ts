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
	/** In a room, do not show the other members' pets on the desktop (the original's "Only Show My Desktop Pet"). */
	onlyShowMyPet: boolean
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

/** A role of the passport account, as the browser login lists it (no token, no passport data). */
export interface OnlineLoginRole {
	playerId: number
	serverId: string
	name: string
}

/** What the app reports while a browser login runs. */
export type OnlineLoginEvent =
	| { stage: "waiting" }
	| { stage: "choose"; roles: OnlineLoginRole[]; switch: boolean }
	| { stage: "done" }
	| { stage: "failed"; message: string; restart: boolean }

/** A member of the room the app is connected to, as the room socket reports them (src-tauri/src/online/room.rs). */
export interface RoomSocketMember {
	/** The server's numeric user id. */
	id: number
	nickname: string
	owner: boolean
	online: boolean
	/** Catalog `assetId` of the character skin; 0 until the server has told. */
	characterAssetId: number
	/** Catalog `assetId` of the accessory; 0 for none. */
	partAssetId: number
	/** Which hand is pressed: "idle", "left" or "right". */
	state: "idle" | "left" | "right"
	/** This user hid this member's pet (the eye in the member list). */
	hidden: boolean
	/** How many taps this member has made; it goes up on each, which moves the pet's hand. */
	tap: number
}

export interface RoomMembersEvent {
	members: RoomSocketMember[]
	/** The logged-in user's own id (their pet is not drawn again as a remote one). */
	selfId: number
	/** Whether the room is public, once the server has said; null until then. */
	isPublic: boolean | null
}

export type RoomStatusEvent =
	| { state: "connecting" | "connected" }
	| { state: "reconnecting"; message: string }
	| { state: "ended"; reason: "left" | "dismissed" | "kicked" | "forced" | "failed"; message: string }

/** An emote another member played: an asset id (number) or an asset name. */
export interface RoomEmoteEvent {
	memberId: number
	emote: number | string
}

export type ChestSide = "left" | "right"

/** Online mode's two desktop chests as the app reports them (src-tauri/src/online/chest.rs). */
export interface ChestClock {
	loggedIn: boolean
	/** The account has the clicks an open needs. */
	eligible: boolean
	/** Milliseconds until each chest is ready as of this message; null when the server's clock is unknown. */
	left: number | null
	right: number | null
}

export interface ChestReward {
	assetId: number
	name: string
	type: string
	rarity: unknown
	side: ChestSide
}

export interface OnlineAPI {
	/** Connects the room socket for a room the server just created or let this user into. */
	roomConnect(roomNo: string, selfId: number): Promise<{ ok: boolean; error?: string }>
	/** Leaves the room on the socket and closes it. */
	roomLeave(): Promise<{ ok: boolean }>
	/** The members of the room as last published, for a page that opened after the event. */
	roomSnapshot(): Promise<{ ok: boolean; error?: string } & Partial<RoomMembersEvent>>
	/** Remembers the equipped skin and accessory (catalog asset ids, 0 for none) and tells the room. */
	roomLooks(character: number, accessory: number): Promise<{ ok: boolean; error?: string }>
	/** Shows or hides one member's pet on the desktop (local only). */
	roomShowMember(userId: number, shown: boolean): Promise<{ ok: boolean; error?: string }>
	/** The owner's actions on another member: kick them or hand the room over. */
	roomMember(action: "kick" | "transfer", userId: number): Promise<{ ok: boolean; error?: string }>
	onRoomError(callback: (event: { message: string }) => void): void
	/** Tells the room the outfit changed, after it was saved to the account. */
	roomChanged(): Promise<{ ok: boolean }>
	onRoomMembers(callback: (event: RoomMembersEvent) => void): void
	onRoomStatus(callback: (event: RoomStatusEvent) => void): void
	onRoomEmote(callback: (event: RoomEmoteEvent) => void): void
	/** Opens the Kuro login page in the browser; the outcome arrives through `onLogin`. */
	loginStart(lang?: string): Promise<{ ok: boolean; error?: string }>
	loginChoose(index: number): Promise<{ ok: boolean; error?: string }>
	/** Lists the roles again with the last login's passport, to change character while logged in. */
	loginSwitch(): Promise<{ ok: boolean; error?: string }>
	loginCancel(): Promise<{ ok: boolean }>
	onLogin(callback: (event: OnlineLoginEvent) => void): void
	request<T = unknown>(
		method: "GET" | "POST" | "PUT" | "DELETE",
		endpoint: string,
		body?: unknown,
	): Promise<OnlineReply<T>>
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
	onChestClock(callback: (clock: ChestClock) => void): void
	/** A chest was opened (from any window): the account's bag has a new item. */
	onChestOpened(callback: (reward: ChestReward) => void): void
	move(dx: number, dy: number): void
	setHoverArea(area: HoverArea): void
	resizeWindow(edge: ResizeEdge, dx: number, dy: number): void
	online: OnlineAPI
}
