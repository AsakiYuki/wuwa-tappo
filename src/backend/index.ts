/*
 * The app's game logic (src/domain), bundled by vite.backend.mts into one script that src-tauri
 * runs in QuickJS (src-tauri/src/backend.rs).
 * Rust owns windows, files and saving; this owns the collection state.
 *
 * Every function takes and returns strings or plain values, so the Rust side never has to map
 * JavaScript objects. Errors from commands are returned as `{ ok: false, error }`, never thrown.
 */
import { registerTap } from "../domain/actions.js"
import { canPlayEmote, importedState, isKnownSave, patchSettings, STATE_COMMANDS } from "../domain/commands.js"
import { initial, normalize } from "../domain/state.js"
import type { CatalogItem, CollectionState } from "../domain/types.js"

// QuickJS has no structuredClone; the state is plain JSON data, so a JSON round trip is equivalent.
globalThis.structuredClone ??= (<T>(value: T): T => JSON.parse(JSON.stringify(value))) as typeof structuredClone

let items: CatalogItem[] = []
let state: CollectionState

/** Every item is unlocked when a profile is opened. */
function unlockEverything(next: CollectionState) {
	for (const item of items) if (!next.owned[item.id]) next.owned[item.id] = 1
	return next
}

const reply = (value: object) => JSON.stringify(value)

const backend = {
	init(catalogJson: string) {
		items = JSON.parse(catalogJson).items
		state = unlockEverything(initial(items))
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
		state = unlockEverything(normalize(raw, items))
		return true
	},

	state: () => JSON.stringify(state, null, 2),

	settings: () => JSON.stringify(state.settings),

	command(name: string, argumentJson: string): string {
		try {
			const argument = argumentJson ? JSON.parse(argumentJson) : null
			if (Object.hasOwn(STATE_COMMANDS, name)) {
				const result = STATE_COMMANDS[name](state, items, argument) ?? null
				return reply({ ok: true, result })
			}
			switch (name) {
				case "settings":
					return reply({ ok: true, result: null, previousSettings: patchSettings(state, argument) })
				case "import-data": {
					// The argument is the chosen file's text.
					const raw: unknown = JSON.parse(String(argument).replace(/^﻿/, ""))
					state = importedState(raw, items, state)
					return reply({ ok: true, result: "imported" })
				}
				case "reset-data":
					state = initial(items)
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
		const emote = registerTap(state, items)
		return reply({ emote, count: state.count, totalCount: state.totalCount, dailyCount: state.dailyCount })
	},

	canPlayEmote: (id: string) => canPlayEmote(state, items, id),

	/** Where the user dragged the pet, in logical pixels. */
	setPetPosition(x: number, y: number) {
		state.settings.petPosition = { x: Math.round(x), y: Math.round(y) }
	},
}

;(globalThis as Record<string, unknown>).WuwaBackend = backend
