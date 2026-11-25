/*
 * The app's game logic (src/domain), bundled by vite.backend.mts into one script that src-tauri
 * runs in QuickJS (src-tauri/src/backend.rs).
 * Rust owns windows, files and saving; this owns the collection state.
 *
 * Every function takes and returns strings or plain values, so the Rust side never has to map
 * JavaScript objects. Errors from commands are returned as `{ ok: false, error }`, never thrown.
 *
 * There are two collections: the offline one and the online profile (src/domain/profile.ts). The
 * `onlineMode` setting, which both share, says which one the pages see and the commands change.
 */
import { registerTap } from "../domain/actions.js"
import {
	assertOffline,
	canPlayEmote,
	importedState,
	isKnownSave,
	patchSettings,
	STATE_COMMANDS,
} from "../domain/commands.js"
import { loadOnlineProfile, saveBoth, shareSettings } from "../domain/profile.js"
import { initial, normalize } from "../domain/state.js"
import type { CatalogItem, CollectionState } from "../domain/types.js"

// QuickJS has no structuredClone; the state is plain JSON data, so a JSON round trip is equivalent.
globalThis.structuredClone ??= (<T>(value: T): T => JSON.parse(JSON.stringify(value))) as typeof structuredClone

let items: CatalogItem[] = []
let offline: CollectionState
let online: CollectionState

/** The collection in use: the online profile while online mode is on. */
const current = () => (offline.settings.onlineMode ? online : offline)

/** Every item is unlocked when an offline profile is opened. */
function unlockEverything(next: CollectionState) {
	for (const item of items) if (!next.owned[item.id]) next.owned[item.id] = 1
	return next
}

const reply = (value: object) => JSON.stringify(value)

const backend = {
	init(catalogJson: string) {
		items = JSON.parse(catalogJson).items
		offline = unlockEverything(initial(items))
		online = initial(items)
		shareSettings(offline, online)
	},

	/** Loads a save's text; returns false (keeping the current state) if it is not a valid save. */
	load(text: string): boolean {
		let raw: unknown
		try {
			raw = JSON.parse(text.replace(/^﻿/, ""))
		} catch {
			return false
		}
		if (!isKnownSave(raw)) return false
		offline = unlockEverything(normalize(raw, items))
		online = loadOnlineProfile(raw, items)
		shareSettings(offline, online)
		return true
	},

	/** What the pages see: the collection in use. */
	state: () => JSON.stringify(current(), null, 2),

	/** What is written to collection.json: both collections. */
	save: () => saveBoth(offline, online),

	settings: () => JSON.stringify(offline.settings),

	command(name: string, argumentJson: string): string {
		try {
			const argument = argumentJson ? JSON.parse(argumentJson) : null
			assertOffline(offline, name)
			if (Object.hasOwn(STATE_COMMANDS, name)) {
				const result = STATE_COMMANDS[name](current(), items, argument) ?? null
				return reply({ ok: true, result })
			}
			switch (name) {
				case "settings": {
					const previousSettings = patchSettings(offline, argument)
					shareSettings(offline, online)
					if (offline.settings.counterLimit !== null && online.count > offline.settings.counterLimit)
						online.count = offline.settings.counterLimit
					return reply({ ok: true, result: null, previousSettings })
				}
				case "import-data": {
					// The argument is the chosen file's text.
					const raw: unknown = JSON.parse(String(argument).replace(/^﻿/, ""))
					offline = importedState(raw, items, offline)
					shareSettings(offline, online)
					return reply({ ok: true, result: "imported" })
				}
				case "reset-data":
					offline = initial(items)
					shareSettings(offline, online)
					return reply({ ok: true, result: null })
				default:
					return reply({ ok: false, error: "Unknown command" })
			}
		} catch (error) {
			return reply({ ok: false, error: error instanceof Error ? error.message : String(error) })
		}
	},

	/** Counts one tap; the emote to play, if any, comes back with the new counters. */
	tap(): string {
		const state = current()
		const emote = registerTap(state, items)
		return reply({ emote, count: state.count, totalCount: state.totalCount, dailyCount: state.dailyCount })
	},

	canPlayEmote: (id: string) => canPlayEmote(current(), items, id),

	/** Where the user dragged the pet, in logical pixels. */
	setPetPosition(x: number, y: number) {
		offline.settings.petPosition = { x: Math.round(x), y: Math.round(y) }
	},
}

;(globalThis as Record<string, unknown>).WuwaBackend = backend
