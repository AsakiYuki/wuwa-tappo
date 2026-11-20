import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { initial, normalize } from "./core.js"
import { isKnownSave } from "./domain/commands.js"
import type { CatalogItem, CollectionState, ProfileResult, SavedState } from "./types.js"

const SAVE_FILE = "collection.json"
const SAVE_NAMES = [SAVE_FILE, SAVE_FILE + ".bak"]
/** Folders that older portable builds were unpacked into. */
const LEGACY_FOLDER = /^WuwaTappo-Offline/i
const LEGACY_SEARCH_DEPTH = 2

/** Reads a save file, returning null if it is missing, unparsable or not a known save version. */
function readSave(file: string): SavedState | null {
	try {
		const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""))
		if (!isKnownSave(raw)) return null
		return { raw, file, mtime: fs.statSync(file).mtimeMs }
	} catch {
		return null
	}
}

function listDirectories(directory: string): fs.Dirent[] {
	try {
		return fs.readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory())
	} catch {
		return []
	}
}

/** Collects saves stored in `<dir>/data/`, descending into old portable-build folders. */
function collectLegacySaves(directory: string, depth: number, found: Map<string, SavedState>) {
	for (const name of SAVE_NAMES) {
		const save = readSave(path.join(directory, "data", name))
		const folder = save && path.dirname(save.file)
		if (save && !found.has(folder)) found.set(folder, save)
	}
	if (depth === 0) return
	for (const entry of listDirectories(directory)) {
		if (!entry.isSymbolicLink() && LEGACY_FOLDER.test(entry.name))
			collectLegacySaves(path.join(directory, entry.name), depth - 1, found)
	}
}

/**
 * Finds a save left by an older portable build: first next to the app,
 * otherwise the most recently modified one in sibling or search-root folders.
 */
function findLegacy(portableDir: string, searchRoots: string[] = []): SavedState | null {
	const direct = SAVE_NAMES.map(name => readSave(path.join(portableDir, "data", name))).find(Boolean)
	if (direct) return direct

	const found = new Map<string, SavedState>()
	for (const root of new Set([path.dirname(portableDir), ...searchRoots]))
		collectLegacySaves(root, LEGACY_SEARCH_DEPTH, found)
	return [...found.values()].sort((left, right) => right.mtime - left.mtime)[0] || null
}

/** Copies a legacy save into the data folder and records where it came from. */
function backUpMigration(dataDir: string, source: SavedState) {
	const backups = path.join(dataDir, "migration-backups")
	fs.mkdirSync(backups, { recursive: true })
	const copy = path.join(backups, `collection-${Date.now()}.json`)
	fs.copyFileSync(source.file, copy)
	const record = {
		from: source.file,
		backup: copy,
		at: new Date().toISOString(),
		sha256: crypto.createHash("sha256").update(fs.readFileSync(source.file)).digest("hex"),
	}
	fs.writeFileSync(path.join(dataDir, "migration.json"), JSON.stringify(record, null, 2))
}

/**
 * Loads the profile, in order of preference: the current save, its backup,
 * a migrated legacy save, or a fresh collection. A corrupt save is kept aside, never overwritten.
 */
function initProfile({
	dataDir,
	portableDir,
	searchRoots = [],
	items,
}: {
	dataDir: string
	portableDir: string
	searchRoots?: string[]
	items: CatalogItem[]
}): ProfileResult {
	fs.mkdirSync(dataDir, { recursive: true })
	const file = path.join(dataDir, SAVE_FILE)

	const current = readSave(file)
	if (current) return { state: normalize(current.raw, items), warning: "" }

	const backup = readSave(file + ".bak")
	if (backup) return { state: normalize(backup.raw, items), warning: "Restored collection from backup" }

	if (fs.existsSync(file)) {
		fs.copyFileSync(file, `${file}.damaged-${Date.now()}`)
		return {
			state: initial(items),
			warning:
				"The save could not be read. The original file was kept; open the save folder in Settings to recover it.",
		}
	}

	const legacy = findLegacy(portableDir, searchRoots)
	if (!legacy) return { state: initial(items), warning: "" }
	backUpMigration(dataDir, legacy)
	const state = normalize(legacy.raw, items)
	// Saves found by searching (e.g. an archive unpacked in Downloads) are not trusted to enable auto-start.
	if (path.dirname(path.dirname(legacy.file)) !== path.resolve(portableDir)) state.settings.autoStart = false
	return {
		state,
		warning: "Migrated collection and settings from the previous version",
		migratedFrom: legacy.file,
	}
}

/**
 * Returns a writer that saves atomically (write temp file, keep a .bak, rename)
 * and serialises writes so an older state can never land after a newer one.
 */
function createWriter(file: string) {
	let pending = Promise.resolve()
	return (state: CollectionState): Promise<void> => {
		const content = JSON.stringify(state, null, 2)
		const write = pending.then(async () => {
			await fs.promises.writeFile(file + ".tmp", content)
			try {
				await fs.promises.copyFile(file, file + ".bak")
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
			}
			await fs.promises.rename(file + ".tmp", file)
		})
		pending = write.catch(() => {})
		return write
	}
}

export { readSave, initProfile, createWriter }
