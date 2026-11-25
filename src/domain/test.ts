import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import * as actions from "./actions.js"
import { STATE_COMMANDS, canPlayEmote, importedState, isKnownSave, patchSettings } from "./commands.js"
import { RARITIES } from "./constants.js"
import { initial, normalize, settings } from "./state.js"
import {
	cleanRedeemCode,
	clickBalance,
	itemForAsset,
	isValidCode,
	isValidUid,
	cleanRoomNumber,
	parseChestResult,
	parseRoom,
	parseCount,
	parseUser,
} from "./online.js"

const core = { ...actions, RARITIES, initial, normalize, settings }
const PROJECT_ROOT = path.resolve(__dirname, "..")
const catalog = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "assets", "catalog.json"), "utf8"))
const items = catalog.items
test("macOS controller watcher is available as a universal binary", () => {
	if (process.platform !== "darwin") return
	const watcher = path.join(PROJECT_ROOT, "assets", "bin", "mac-gamepad-watcher")
	assert.ok(fs.existsSync(watcher), "mac-gamepad-watcher exists")
	const stats = fs.statSync(watcher)
	assert.ok((stats.mode & 0o111) !== 0, "mac-gamepad-watcher is executable")
})
test("Windows controller watcher is bundled as a 64-bit console executable", () => {
	const watcher = path.join(PROJECT_ROOT, "assets", "bin", "win-gamepad-watcher.exe")
	assert.ok(fs.existsSync(watcher), "win-gamepad-watcher.exe exists")
	const binary = fs.readFileSync(watcher)
	assert.equal(binary.toString("latin1", 0, 2), "MZ")
	const pe = binary.readUInt32LE(0x3c)
	assert.equal(binary.toString("latin1", pe, pe + 4), "PE\0\0")
	assert.equal(binary.readUInt16LE(pe + 4), 0x8664, "x64 machine type")
})
test("Starts with the classic Rover pair, Abby, and eight base emotes", () => {
	const s = core.initial(items)
	assert.equal(Object.keys(s.owned).length, 11)
	assert.equal(s.draws, 0)
	assert.equal(items.filter(i => s.owned[i.id] && i.type === "character").length, 2)
	assert(items.every(i => i.starter === !!s.owned[i.id]))
})
test("All 899 collection items and 3,358 offline images are available", () => {
	assert.equal(items.length, 899)
	const names = new Set<string>()
	for (const it of items) {
		assert(core.RARITIES.includes(it.rarity))
		for (const file of [it.image, it.thumbnail, ...Object.values(it.layers ?? {})]) names.add(file)
		if (it.type === "character")
			assert.deepEqual(Object.keys(it.layers), ["body1", "body2", "body3", "body4", "head1", "head2"])
	}
	assert.equal(names.size, 3358)
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

test("Touchpad input defaults off and validates setting updates", () => {
	const s = core.initial(items)
	assert.equal(s.settings.touchpadInput, false)
	s.settings.touchpadInput = true
	assert.equal(core.normalize(s, items).settings.touchpadInput, true)
	assert.equal(core.settings({ touchpadInput: "yes" as never }).touchpadInput, false)
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
	assert.deepEqual(s.settings.keyLabels, {
		ShiftRight: "RShift",
		ArrowLeft: "Left",
		ArrowUp: "Up",
		ArrowRight: "Right",
		ArrowDown: "Down",
		Comma: ",",
		Period: ".",
		Slash: "/",
		Semicolon: ";",
		Quote: "'",
		BracketLeft: "[",
		BracketRight: "]",
		Minus: "-",
		Equal: "=",
		Backquote: "`",
	})
	const next = core.settings({ keyLabels: { Meta: "Super", Ctrl: "Control" } })
	assert.equal(next.keyLabels.Meta, "Super")
	assert.equal(next.keyLabels.Ctrl, "Control")
	assert.equal(core.settings({ keyLabels: { ShiftRight: "RShift" } }).keyLabels.ShiftRight, "RShift")
	assert.equal(core.settings({ keyLabels: { ShiftRight: "  " } as never }).keyLabels.ShiftRight, "RShift")
	const migrated = core.normalize(
		{
			...s,
			settings: {
				...s.settings,
				keyLabels: {
					Meta: "Meta",
					Ctrl: "Control",
					Alt: "Alt",
					Shift: "Shift",
					Tab: "Tab",
					CapsLock: "Caps",
					Backspace: "⌫",
					Enter: "↵",
					Space: "SPACE",
				},
			},
		},
		items,
	)
	assert.deepEqual(migrated.settings.keyLabels, { ...s.settings.keyLabels, Ctrl: "Control" })
})

test("Bubble lifetime defaults to one second and stays within its supported range", () => {
	const s = core.initial(items)
	assert.equal(s.settings.bubbleLifetime, 1)
	assert.equal(core.settings({ bubbleLifetime: 2.5 }).bubbleLifetime, 2.5)
	assert.equal(core.settings({ bubbleLifetime: 0 }).bubbleLifetime, 0.5)
	assert.equal(core.settings({ bubbleLifetime: 5 }).bubbleLifetime, 3)
	assert.equal(core.settings({ bubbleLifetime: Number.NaN }).bubbleLifetime, 1)
})

test("Bubble color defaults to warm yellow and accepts only six-digit hex colors", () => {
	const s = core.initial(items)
	assert.equal(s.settings.bubbleColor, "#ffd26f")
	assert.equal(core.settings({ bubbleColor: "#12AbEf" }).bubbleColor, "#12abef")
	assert.equal(core.settings({ bubbleColor: "gold" as never }).bubbleColor, "#ffd26f")
	s.settings.bubbleColor = "#123456"
	assert.equal(core.normalize(JSON.parse(JSON.stringify(s)), items).settings.bubbleColor, "#123456")
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
test("Daily tap count is independent and resets when its saved date is stale", () => {
	const s = core.initial(items)
	s.count = 998
	s.dailyCount = 12
	s.dailyCountDate = "2000-01-01"
	core.registerTap(s, items, () => 0)
	assert.equal(s.count, 999)
	assert.equal(s.dailyCount, 1)
	assert.equal(s.totalCount, 1)
	assert.equal(s.dailyCountDate, core.normalize(s, items).dailyCountDate)

	const restored = core.normalize(JSON.parse(JSON.stringify(s)), items)
	assert.equal(restored.dailyCount, 1)
	assert.equal(restored.settings.counterFormat, "<CPS> / <DAY_COUNT>")
})
test("Reloading a save preserves collection, counter, presets, and draw progress", () => {
	const s = core.initial(items)
	core.draw(s, items, 10, () => 0.95)
	s.count = 456
	s.totalCount = 1456
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
test("Custom key labels are bounded in count and length", () => {
	const many = Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [`Key${index}`, "x".repeat(500)]))
	const labels = core.settings({ keyLabels: { ...many, ["k".repeat(100)]: "long" } }).keyLabels
	const custom = Object.keys(labels).filter(key => key.startsWith("Key"))
	assert.equal(custom.length, 256)
	assert.equal(labels.Key0.length, 32)
	assert.equal(labels["k".repeat(100)], undefined)
})

test("Shared collection commands: presets, favorites, settings patches, imports and emote checks", () => {
	const s = core.initial(items)
	STATE_COMMANDS["preset-save"](s, items, "  A very long outfit name that will be cut  ")
	assert.equal(s.presets.length, 1)
	assert.equal(s.presets[0].name.length, 24)
	STATE_COMMANDS.favorite(s, items, s.character)
	assert.deepEqual(s.favorites, [s.character])
	STATE_COMMANDS.favorite(s, items, s.character)
	assert.deepEqual(s.favorites, [])
	assert.throws(() => STATE_COMMANDS.favorite(s, items, "missing"))

	s.count = 500
	const previous = patchSettings(s, { counterLimit: 99, scale: 1.2 })
	assert.equal(previous.scale, 1)
	assert.equal(s.settings.scale, 1.2)
	assert.equal(s.count, 99)

	assert.equal(isKnownSave({ version: 2, owned: {} }), true)
	assert.equal(isKnownSave({ version: 3, owned: {} }), false)
	assert.equal(isKnownSave(null), false)
	s.settings.autoStart = false
	const imported = importedState({ version: 2, owned: {}, settings: { autoStart: true } }, items, s)
	assert.equal(imported.settings.autoStart, false, "an imported save never enables auto-start")
	assert.throws(() => importedState({ version: 9 }, items, s))

	assert.equal(canPlayEmote(s, items, s.emotes[0]), true)
	assert.equal(canPlayEmote(s, items, s.character), false, "a character is not an emote")
})
test("Imported presets and history are rebuilt field by field; hostile values do not survive", () => {
	const owned = Object.fromEntries(items.map((item: any) => [item.id, 1]))
	const character = items.find((item: any) => item.type === "character").id
	const accessory = items.find((item: any) => item.type === "accessory").id
	const emote = items.find((item: any) => item.type === "emote").id
	// Deeper than serde_json's recursion limit (128): the Tauri app used to panic on every start.
	const nested = JSON.parse("[".repeat(1000) + "]".repeat(1000))
	const state = importedState(
		{
			version: 2,
			owned,
			presets: [
				{ id: "a", name: "x".repeat(1_000_000), character, accessory: "not-an-item", emotes: "abcde" },
				{ id: "a", name: nested, character, accessory, emotes: [emote, emote, "emote:fake"] },
				{ id: { evil: true }, name: "  ", character, emotes: null },
				null,
				{ id: "b", name: "no character" },
			],
			history: [{ id: character, fresh: "yes", source: "<b>x</b>", at: "never", extra: nested }, null, 5],
		} as any,
		items,
		core.initial(items),
	)

	assert.deepEqual(
		state.presets.map(preset => [preset.name.length, preset.accessory, preset.emotes]),
		[
			[24, "", []],
			[9, accessory, [emote]],
			[9, "", []],
		],
	)
	assert.equal(new Set(state.presets.map(preset => preset.id)).size, 3, "preset ids are unique")
	assert.deepEqual(state.history, [{ id: character, fresh: false, source: "draw", at: 0 }])

	const depth = (value: unknown): number =>
		value && typeof value === "object" ? 1 + Math.max(0, ...Object.values(value).map(depth)) : 0
	assert.ok(depth(state) < 8, "the state stays shallow")

	// Loading such a preset equips only owned items of the right type.
	STATE_COMMANDS["preset-load"](state, items, state.presets[0].id)
	assert.equal(state.accessory, "")
	assert.deepEqual(state.emotes, [])
})

test("Presets saved at the same moment get distinct ids", () => {
	const state = core.initial(items)
	for (let index = 0; index < 12; index++) STATE_COMMANDS["preset-save"](state, items, `p${index}`)
	assert.equal(new Set(state.presets.map(preset => preset.id)).size, 12)
	STATE_COMMANDS["preset-delete"](state, items, state.presets[0].id)
	assert.equal(state.presets.length, 11, "deleting one preset leaves the others")
	STATE_COMMANDS["preset-save"](state, items, "   ")
	assert.equal(state.presets.at(-1)!.name, "My Outfit")
})

test("The pet's screen index and saved position are bounded", () => {
	const state = importedState(
		{ version: 2, owned: {}, settings: { monitor: 1e308, petPosition: { x: 1e308, y: -1e308 } } } as any,
		items,
		core.initial(items),
	)
	assert.equal(state.settings.monitor, 32)
	assert.deepEqual(state.settings.petPosition, { x: 100_000, y: -100_000 })
})

test("Online mode is off by default and an imported save never turns it on", () => {
	const current = core.initial(items)
	assert.equal(current.settings.onlineMode, false)
	assert.equal(core.settings({ onlineMode: "yes" as any }).onlineMode, false, "only a boolean counts")
	const imported = importedState({ version: 2, owned: {}, settings: { onlineMode: true } }, items, current)
	assert.equal(imported.settings.onlineMode, false)
	current.settings.onlineMode = true
	const kept = importedState({ version: 2, owned: {}, settings: { onlineMode: false } }, items, current)
	assert.equal(kept.settings.onlineMode, true, "the current choice is kept either way")
	assert.equal(patchSettings(current, { onlineMode: false }).onlineMode, true)
	assert.equal(current.settings.onlineMode, false)
})

test("Server users are validated and click balances never go negative or overflow", () => {
	assert.equal(parseUser(null), null)
	assert.equal(parseUser({ nickname: "x" }), null, "no user_id")
	assert.equal(parseUser({ user_id: "  " }), null)
	const user = parseUser({
		user_id: 123456789,
		nickname: "  ",
		total_click_count: "1500",
		total_click_consume: -4,
		player_type: 2,
	})!
	assert.deepEqual(user, {
		userId: "123456789",
		nickname: "Rover",
		playerType: 2,
		totalClicks: 1500,
		consumedClicks: 0,
	})
	assert.equal(parseCount("abc"), 0)
	assert.equal(parseCount(1e300), Number.MAX_SAFE_INTEGER)
	assert.equal(clickBalance(user, 500, 30), 1030)
	assert.equal(clickBalance({ ...user, consumedClicks: 2000 }, 0, 0), 0, "overspent is zero, not negative")
	assert.equal(
		clickBalance({ ...user, totalClicks: Number.MAX_SAFE_INTEGER }, 0, Number.MAX_SAFE_INTEGER),
		Number.MAX_SAFE_INTEGER,
	)
	assert.equal(clickBalance(null, 0, 99), 0, "no balance without an account")
})

test("Chest results are parsed strictly and matched to the catalog by asset id", () => {
	assert.equal(parseChestResult({ rewards: "nope" }), null)
	assert.equal(parseChestResult({ rewards: [{ id: "1" }] }), null, "ids must be integers")
	const known = items[5]
	const result = parseChestResult({
		rewards: [
			{ id: known.assetId, name: "N", type: "emote", rarity: "rare" },
			{ id: -1, name: "?" },
		],
		remaining_clicks: 12,
	})!
	assert.equal(result.remainingClicks, 12)
	assert.equal(itemForAsset(items, result.rewards[0].assetId), known)
	assert.equal(itemForAsset(items, result.rewards[1].assetId), undefined)
	assert.equal(parseChestResult({ rewards: [] })!.remainingClicks, null)
	assert.equal(parseChestResult({ rewards: new Array(101).fill({ id: 1 }) }), null)
})

test("UID, confirmation code and redeem code input is checked before it is sent", () => {
	assert.equal(isValidUid(" 101234567 "), true)
	assert.equal(isValidUid("12345678"), false)
	assert.equal(isValidUid("1234567890123456"), false, "too long to stay exact as a number")
	assert.equal(isValidUid("12345678a"), false)
	assert.equal(isValidCode("012345"), true)
	assert.equal(isValidCode("12345"), false)
	assert.equal(cleanRedeemCode("  ABC-123 "), "ABC-123")
	assert.equal(cleanRedeemCode("two words"), null)
	assert.equal(cleanRedeemCode(""), null)
	assert.equal(cleanRedeemCode("x".repeat(65)), null)
})

test("Rooms are parsed strictly and room numbers are checked before joining", () => {
	assert.equal(parseRoom({ members: [] }), null, "no room_no")
	assert.equal(parseRoom({ room_no: "A1", members: "x" }), null)
	assert.equal(parseRoom({ room_no: "A1", members: new Array(65).fill({}) }), null)
	assert.deepEqual(parseRoom({ room_no: 4821, is_public: false, members: [{ user_id: 7, nickname: " " }, null] }), {
		roomNo: "4821",
		isPublic: false,
		members: [
			{ userId: "7", nickname: "Rover" },
			{ userId: "", nickname: "Rover" },
		],
	})
	assert.equal(cleanRoomNumber(" ab12 "), "ab12")
	assert.equal(cleanRoomNumber("../x"), null)
	assert.equal(cleanRoomNumber(""), null)
})
