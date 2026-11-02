import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import * as core from "./core.js"
import * as storage from "./storage.js"
import os from "node:os"
import { setLinuxAutoStart } from "./autostart.js"
const PROJECT_ROOT = path.resolve(__dirname, "..")
const catalog = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "assets", "catalog.json"), "utf8"))
const items = catalog.items
test("Linux launch-at-startup creates and removes an XDG autostart entry", () => {
	const configDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "wuwa-autostart-"))
	const entry = path.join(configDirectory, "autostart", "wuwa-tappo.desktop")
	try {
		setLinuxAutoStart(true, configDirectory, "/opt/Wuwa Tappo/wuwa-tappo")
		assert.equal(
			fs.readFileSync(entry, "utf8"),
			[
				"[Desktop Entry]",
				"Type=Application",
				"Name=Wuwa Tappo",
				'Exec="/opt/Wuwa Tappo/wuwa-tappo"',
				"Terminal=false",
				"",
			].join("\n"),
		)
		setLinuxAutoStart(false, configDirectory, "/opt/Wuwa Tappo/wuwa-tappo")
		assert.equal(fs.existsSync(entry), false)
	} finally {
		fs.rmSync(configDirectory, { recursive: true, force: true })
	}
})
test("Starts with the classic Rover pair, Abby, and eight base emotes", () => {
	const s = core.initial(items)
	assert.equal(Object.keys(s.owned).length, 11)
	assert.equal(s.draws, 0)
	assert.equal(items.filter(i => s.owned[i.id] && i.type === "character").length, 2)
	assert(items.every(i => i.starter === !!s.owned[i.id]))
})
test("All 899 collection items and 3,098 offline images are available", () => {
	assert.equal(items.length, 899)
	const names = new Set<string>()
	for (const it of items) {
		assert(core.RARITIES.includes(it.rarity))
		for (const file of [it.image, it.thumbnail, ...Object.values(it.layers ?? {})]) names.add(file)
		if (it.type === "character") assert.equal(Object.keys(it.layers).length, 5)
	}
	assert.equal(names.size, 3098)
	for (const file of names) {
		const b = fs.readFileSync(path.join(PROJECT_ROOT, file))
		assert.equal(b.readUInt32BE(0), 0x89504e47)
		assert(b.readUInt32BE(16) > 0 && b.readUInt32BE(20) > 0)
	}
})
test("Ten-pull rarity guarantee, 50-pull Epic pity, and unlimited free draws", () => {
	const s = core.initial(items)
	for (let i = 0; i < 100; i++) {
		const before = s.draws,
			r = core.draw(s, items, 10, () => 0)
		assert.equal(r.length, 10)
		assert.equal(s.draws, before + 10)
		assert(r.some(x => items.find(i => i.id === x.id).rarity !== "common"))
	}
	assert.equal(s.draws, 1000)
	assert.equal(s.pity, 0)
	assert(items.some(x => x.rarity === "epic" && s.owned[x.id]))
})
test("Unowned items cannot be equipped; character, accessory, and emote types stay valid", () => {
	const s = core.initial(items)
	assert.throws(() => core.equip(s, items, items.find(x => !x.starter).id))
	const male = items.find(x => x.starter && x.roleId === 1501)
	core.equip(s, items, male.id)
	assert.equal(s.character, male.id)
	const a = s.accessory
	core.equip(s, items, a)
	assert.equal(s.accessory, "")
	core.equip(s, items, a)
	assert.equal(s.accessory, a)
})
test("Ten syntheses consume 100 duplicates, keep one copy, and do nothing when materials are insufficient", () => {
	const s = core.initial(items),
		id = s.character
	s.owned[id] = 101
	const before = Object.values(s.owned as Record<string, number>).reduce((a, b) => a + b, 0)
	const r = core.synthesize(s, items, 10, "common", () => 0.2)
	assert.equal(r.length, 10)
	assert.equal(s.owned[id], 1)
	assert.equal(
		Object.values(s.owned as Record<string, number>).reduce((a, b) => a + b, 0),
		before - 90,
	)
	assert(r.every(x => items.find(i => i.id === x.id).rarity === "uncommon"))
	const snapshot = JSON.stringify(s)
	assert.throws(() => core.synthesize(s, items, 10, "common"))
	assert.equal(JSON.stringify(s), snapshot)
})
test("Hold animation defaults off and persists when enabled", () => {
	const s = core.initial(items)
	assert.equal(s.settings.holdAnimation, false)
	s.settings.holdAnimation = true
	assert.equal(core.normalize(s, items).settings.holdAnimation, true)
	assert.equal(core.settings({ holdAnimation: "yes" as never }).holdAnimation, false)
})

test("Auto-emote and pressed-key settings default correctly and honor toggles", () => {
	const s = core.initial(items)
	assert.equal(s.settings.autoEmote, true)
	assert.equal(s.settings.showPressedKeys, true)
	assert.equal(s.settings.showMouseBubbles, true)
	s.settings.autoEmote = false
	s.settings.showPressedKeys = false
	s.settings.showMouseBubbles = false
	const next = core.normalize(s, items)
	assert.equal(next.settings.autoEmote, false)
	assert.equal(next.settings.showPressedKeys, false)
	assert.equal(next.settings.showMouseBubbles, false)
	assert.equal(core.settings({ autoEmote: "yes" as never }).autoEmote, true)
	assert.equal(core.settings({ showPressedKeys: "yes" as never }).showPressedKeys, true)
	assert.equal(core.settings({ showMouseBubbles: "yes" as never }).showMouseBubbles, true)
})

test("Keyboard key labels can be overridden from settings", () => {
	const s = core.initial(items)
	assert.equal(s.settings.keyLabels.Meta, "Meta")
	const next = core.settings({ keyLabels: { Meta: "Super", Ctrl: "Control" } })
	assert.equal(next.keyLabels.Meta, "Super")
	assert.equal(next.keyLabels.Ctrl, "Control")
	assert.equal(core.settings({ keyLabels: { Meta: "  " } as never }).keyLabels.Meta, "Meta")
})

test("Bubble lifetime defaults to one second and stays within its supported range", () => {
	const s = core.initial(items)
	assert.equal(s.settings.bubbleLifetime, 1)
	assert.equal(core.settings({ bubbleLifetime: 2.5 }).bubbleLifetime, 2.5)
	assert.equal(core.settings({ bubbleLifetime: 0 }).bubbleLifetime, 0.5)
	assert.equal(core.settings({ bubbleLifetime: 5 }).bubbleLifetime, 3)
	assert.equal(core.settings({ bubbleLifetime: Number.NaN }).bubbleLifetime, 1)
})

test("Controller bubble style defaults to Xbox and validates Xbox or PlayStation", () => {
	const s = core.initial(items)
	assert.equal(s.settings.controllerStyle, "xbox")
	assert.equal(core.settings({ controllerStyle: "ps" }).controllerStyle, "ps")
	assert.equal(core.settings({ controllerStyle: "unknown" as never }).controllerStyle, "xbox")
})

test("Counter still tracks taps when auto-emote is disabled", () => {
	const s = core.initial(items)
	s.settings.autoEmote = false
	s.count = 998
	assert.equal(
		core.registerTap(s, items, () => 0),
		null,
	)
	assert.equal(s.count, 999)
	assert.equal(
		core.registerTap(s, items, () => 0),
		null,
	)
	assert.equal(s.count, 0)
})
test("Reloading a save preserves collection, counter, presets, and draw progress", () => {
	const s = core.initial(items)
	core.draw(s, items, 10, () => 0.95)
	s.count = 456
	s.presets.push({
		id: "p",
		name: "Daily",
		character: s.character,
		accessory: s.accessory,
		emotes: s.emotes,
	})
	const t = core.normalize(JSON.parse(JSON.stringify(s)), items)
	assert.deepEqual(t, s)
})

test("Same-tier synthesis consumes five matching duplicates and keeps one copy", () => {
	const s = core.initial(items),
		id = s.character
	s.owned[id] = 6
	const r = core.synthesize(s, items, 1, "common", () => 0, {
		type: "character",
		mode: "same",
	})
	assert.equal(r.length, 1)
	assert(s.owned[id] >= 1)
	const it = items.find(x => x.id === r[0].id)
	assert.equal(it.type, "character")
	assert.equal(it.rarity, "common")
})
test("Filter index includes seven series, 55 characters, and ten costume items", () => {
	const c = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "assets", "catalog.json"), "utf8"))
	assert.equal(Object.keys(c.filters.series).length, 7)
	assert.equal(Object.keys(c.filters.roles).length, 55)
	assert.equal(c.items.filter(x => x.type === "character" && x.code === "1007").length, 10)
})

test("Migrating a legacy preview save preserves items and counters and restores default emotes", () => {
	const old = {
		...core.initial(items),
		version: 1,
		emotes: ["emote:1965", "emote:1969", "emote:1971"],
		count: 90,
		draws: 20,
	}
	old.owned = {
		"character:590": 1,
		"character:602": 1,
		"accessory:1493": 1,
		"emote:1965": 1,
		"emote:1969": 1,
		"emote:1971": 1,
		"character:332": 2,
	}
	const next = core.normalize(old, items)
	assert.equal(next.version, 2)
	assert.equal(next.draws, 20)
	assert.equal(next.count, 90)
	assert.equal(next.owned["character:332"], 2)
	assert.equal(next.emotes.length, 5)
	assert(items.filter(x => x.starter).every(x => next.owned[x.id] > 0))
})

test("Counter wraps after 999; only owned, equipped emotes are selected, and an empty selection still wraps", () => {
	const s = core.initial(items)
	s.count = 998
	assert.equal(
		core.registerTap(s, items, () => 0),
		null,
	)
	assert.equal(s.count, 999)
	const first = items.find(x => s.emotes.includes(x.id)).id
	assert.equal(
		core.registerTap(s, items, () => 0),
		first,
	)
	assert.equal(s.count, 0)
	s.count = 999
	const last = items.filter(x => s.emotes.includes(x.id)).at(-1).id
	assert.equal(
		core.registerTap(s, items, () => 0.999999),
		last,
	)
	s.count = 999
	s.emotes = ["unknown", s.character]
	assert.equal(core.registerTap(s, items), null)
	assert.equal(s.count, 0)
})
test("Legacy large counters migrate to three digits and preserve always-on-top", () => {
	const s = core.initial(items)
	s.count = 12345
	s.draws = 9000
	s.settings.alwaysOnTop = false
	const legacySave = JSON.parse(JSON.stringify(s))
	delete legacySave.settings.counterLimit
	const next = core.normalize(legacySave, items)
	assert.equal(next.count, 345)
	assert.equal(next.draws, 9000)
	assert.equal(next.settings.alwaysOnTop, false)
	assert.equal(core.settings({ alwaysOnTop: false }).alwaysOnTop, false)
})
test("Hand animation defaults to adaptive and validates saved modes", () => {
	const s = core.initial(items)
	assert.equal(s.settings.handAnimation, "adaptive")
	s.settings.handAnimation = "alternate"
	assert.equal(core.normalize(s, items).settings.handAnimation, "alternate")
	assert.equal(core.settings({ handAnimation: "unknown" as never }).handAnimation, "adaptive")
})
test("Counter wraps at its configured limit or keeps counting when unlimited", () => {
	const s = core.initial(items)
	s.settings.counterLimit = 2
	s.count = 1
	core.registerTap(s, items)
	assert.equal(s.count, 2)
	core.registerTap(s, items)
	assert.equal(s.count, 0)

	s.settings.counterLimit = null
	s.count = 900
	core.registerTap(s, items)
	assert.equal(s.count, 901)

	const restored = core.normalize(JSON.parse(JSON.stringify(s)), items)
	assert.equal(restored.settings.counterLimit, null)
	assert.equal(restored.count, 901)
})
test("All 504 interactive emotes use original emote assets; atlas thumbnails use separate indexes", () => {
	const manifest = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "asset-manifest.json"), "utf8"))
	const emotes = items.filter(item => item.type === "emote")
	assert.equal(emotes.length, 504)

	for (const item of emotes) {
		assert.match(item.image, /^assets\/emotes\//)
		const manifestKey = item.image.slice("assets/".length)
		assert.match(manifest[manifestKey] ?? "", /\/emote\//)
		assert.notEqual(item.image, item.thumbnail)
	}
})

test("Replace a chosen slot when five emotes are equipped; equipped emotes swap slots; unowned emotes cannot replace", () => {
	const s = core.initial(items),
		old = [...s.emotes],
		next = items.find(x => x.starter && x.type === "emote" && !old.includes(x.id)).id
	core.replaceEmote(s, items, next, 2)
	assert.equal(s.emotes[2], next)
	assert.equal(s.emotes.length, 5)
	assert.equal(new Set(s.emotes).size, 5)
	core.replaceEmote(s, items, s.emotes[0], 4)
	assert.equal(s.emotes[4], old[0])
	assert.equal(s.emotes[0], old[4])
	const before = JSON.stringify(s)
	assert.throws(() => core.replaceEmote(s, items, "emote:missing", 1))
	assert.equal(JSON.stringify(s), before)
})
test("Upgrading migrates and backs up the portable save; later installs reuse it", async () => {
	const root = fs.mkdtempSync(path.join(PROJECT_ROOT, "qa-data-unit-"))
	try {
		const legacy = path.join(root, "old"),
			dataDir = path.join(root, "profile")
		fs.mkdirSync(path.join(legacy, "data"), { recursive: true })
		const s = core.initial(items)
		core.draw(s, items, 10, () => 0.95)
		s.count = 521
		fs.writeFileSync(path.join(legacy, "data/collection.json"), JSON.stringify(s))
		const first = storage.initProfile({ dataDir, portableDir: legacy, items })
		assert.deepEqual(first.state, s)
		assert(first.migratedFrom)
		assert.equal(fs.readdirSync(path.join(dataDir, "migration-backups")).length, 1)
		const write = storage.createWriter(path.join(dataDir, "collection.json"))
		first.state.count = 522
		await write(first.state)
		const second = storage.initProfile({
			dataDir,
			portableDir: path.join(root, "new-version"),
			items,
		})
		assert.equal(second.state.count, 522)
		assert.deepEqual(second.state.owned, s.owned)
		assert.equal(second.migratedFrom, undefined)
		assert.equal(JSON.parse(fs.readFileSync(path.join(legacy, "data/collection.json"), "utf8")).count, 521)
	} finally {
		if (!root.startsWith(PROJECT_ROOT + path.sep + "qa-data-unit-")) throw Error("Unsafe cleanup")
		fs.rmSync(root, { recursive: true })
	}
})
test("A fresh install finds the old Downloads save and preserves draws, favorites, and presets", () => {
	const root = fs.mkdtempSync(path.join(PROJECT_ROOT, "qa-data-unit-"))
	try {
		const downloads = path.join(root, "Downloads"),
			legacy = path.join(downloads, "WuwaTappo-Offline-42keys-v1.0.2", "WuwaTappo-Offline-1.0.2", "data")
		fs.mkdirSync(legacy, { recursive: true })
		const s = core.initial(items)
		s.draws = 450
		s.favorites = [s.character]
		s.presets = [
			{
				id: "old",
				name: "Old Outfit",
				character: s.character,
				accessory: s.accessory,
				emotes: s.emotes,
			},
		]
		fs.writeFileSync(path.join(legacy, "collection.json"), JSON.stringify(s))
		const migrated = storage.initProfile({
			dataDir: path.join(root, "profile"),
			portableDir: path.join(downloads, "new"),
			searchRoots: [downloads],
			items,
		})
		assert.deepEqual(migrated.state, s)
	} finally {
		if (!root.startsWith(PROJECT_ROOT + path.sep + "qa-data-unit-")) throw Error("Unsafe cleanup")
		fs.rmSync(root, { recursive: true })
	}
})
test("Queued saves complete in order and do not overwrite newer state", async () => {
	const root = fs.mkdtempSync(path.join(PROJECT_ROOT, "qa-data-unit-"))
	try {
		const file = path.join(root, "collection.json"),
			write = storage.createWriter(file),
			s = core.initial(items),
			jobs = []
		for (let i = 0; i < 20; i++) {
			s.count = i
			jobs.push(write(s))
		}
		await Promise.all(jobs)
		assert.equal(storage.readSave(file).raw.count, 19)
		assert.equal(storage.readSave(file + ".bak").raw.count, 18)
	} finally {
		if (!root.startsWith(PROJECT_ROOT + path.sep + "qa-data-unit-")) throw Error("Unsafe cleanup")
		fs.rmSync(root, { recursive: true })
	}
})
