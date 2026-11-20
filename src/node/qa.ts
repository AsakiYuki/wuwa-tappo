import fs from "node:fs"
import path from "node:path"
import assert from "node:assert/strict"
import type { App, BrowserWindow } from "electron"
import type { CatalogItem, CollectionState } from "./types.js"

interface QaOptions {
	app: App
	pet: BrowserWindow
	studio: BrowserWindow
	items: CatalogItem[]
	getState: () => CollectionState
	dataDir: string
	input: (key: string, down: boolean, side?: "left" | "right", newPhysicalPress?: boolean) => void
}

export async function runQa({ app, pet, studio, items, getState, dataDir, input }: QaOptions) {
	const out = process.env.WUWA_QA_OUTPUT || path.join(__dirname, "..", "..", "qa")
	fs.mkdirSync(out, { recursive: true })
	const errors: string[] = []
	for (const window of [pet, studio])
		window.webContents.on("console-message", (event, level, message) => {
			const line = event.message || message
			const kind = event.level ?? level
			if ((kind === 3 || kind === "error") && !/ERR_BLOCKED_BY_CLIENT/.test(line)) errors.push(line)
		})
	const results: string[] = []

	/* ------------------------------ helpers ------------------------------ */

	const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
	const js = (window: BrowserWindow, script: string) => window.webContents.executeJavaScript(script)
	const click = (window: BrowserWindow, selector: string) =>
		js(window, `document.querySelector(${JSON.stringify(selector)}).click()`)
	const openPage = (page: string) => click(studio, `[data-page=${page}]`)
	const studioTest = () => js(studio, "window.__studioTest()")
	const petTest = () => js(pet, "window.__petTest()")
	const settingsTabCount = () =>
		js(studio, 'document.querySelectorAll("#settingsRows .settings-tabs [role=tab]").length')

	/** Drags a settings range input from its thumb towards the far end with real mouse events. */
	async function dragRange(setting: string) {
		const range = await js(
			studio,
			`(() => {
				const input = document.querySelector("#settingsRows [data-setting=${setting}]")
				const bounds = input.getBoundingClientRect()
				const ratio = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min))
				return {
					x: bounds.x + 8 + ratio * (bounds.width - 16),
					y: bounds.y + bounds.height / 2,
					targetX: ratio > 0.5 ? bounds.x + 10 : bounds.x + bounds.width - 10,
					containerWidth: input.parentElement.getBoundingClientRect().width,
				}
			})()`,
		)
		const send = (event: Electron.MouseInputEvent) => studio.webContents.sendInputEvent(event)
		send({ type: "mouseDown", x: range.x, y: range.y, button: "left", clickCount: 1 })
		send({ type: "mouseMove", x: range.targetX, y: range.y })
		send({ type: "mouseUp", x: range.targetX, y: range.y, button: "left", clickCount: 1 })
		await wait(150)
		return range as { containerWidth: number }
	}

	/** Computed text and border colour of a key bubble rendered with the current bubble colour. */
	const keyBubbleColors = (): Promise<{ text: string; border: string }> =>
		js(
			pet,
			`(() => {
				const bubble = document.createElement("div")
				bubble.className = "local-key-bubble"
				document.getElementById("bubble").append(bubble)
				const style = getComputedStyle(bubble)
				const colors = { text: style.color, border: style.borderTopColor }
				bubble.remove()
				return colors
			})()`,
		)

	async function capture(name: string, window: BrowserWindow) {
		if (!process.argv.includes("--snapshot") && !process.argv.includes("--capture-tests")) return
		window.webContents.invalidate()
		await wait(350)
		const png = (await window.webContents.capturePage()).toPNG()
		if (!png.length) throw Error("Empty screenshot: " + name)
		fs.writeFileSync(path.join(out, name + ".png"), png)
	}
	try {
		for (let i = 0; i < 80; i++) {
			await wait(250)
			if (
				await js(studio, 'typeof window.__studioTest === "function" && window.__studioTest().owned>0').catch(
					() => false,
				)
			)
				break
		}
		studio.show()
		studio.focus()
		pet.showInactive()
		await wait(1800)
		assert.equal((await studioTest()).owned, 11)
		assert((await petTest()).loaded)
		assert.equal((await petTest()).keys, 42)
		assert.equal(
			await js(
				studio,
				'[...document.querySelectorAll(".page")].filter(e=>getComputedStyle(e).display!=="none").length',
			),
			1,
		)
		await openPage("settings")
		for (let attempt = 0; attempt < 20 && (await settingsTabCount()) !== 5; attempt++) await wait(25)
		assert.equal(await settingsTabCount(), 5)
		assert.equal(
			await js(studio, 'document.querySelector("#settingsRows [data-setting=autoStart]")?.type'),
			"checkbox",
		)
		await js(studio, 'document.querySelectorAll("#settingsRows [role=tab]")[1].click()')
		const previousScale = getState().settings.scale
		const scaleRange = await dragRange("scale")
		assert.equal(await settingsTabCount(), 5)
		assert.notEqual(getState().settings.scale, previousScale)
		// Dragging must not re-render the row and change its width.
		assert.equal(
			await js(
				studio,
				'document.querySelector("#settingsRows [data-setting=scale]").parentElement.getBoundingClientRect().width',
			),
			scaleRange.containerWidth,
		)
		const previousOpacity = getState().settings.opacity
		await dragRange("opacity")
		assert.notEqual(getState().settings.opacity, previousOpacity)
		assert.equal(
			await js(pet, 'getComputedStyle(document.getElementById("petRoot")).opacity'),
			String(getState().settings.opacity),
		)
		assert.equal(
			await js(studio, 'document.querySelector("#settingsRows [data-setting=bubbleColor]")?.value'),
			"#ffd26f",
		)
		await js(
			studio,
			"(()=>{const input=document.querySelector('[data-setting=bubbleColor]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'#123456');input.dispatchEvent(new Event('input',{bubbles:true}));})()",
		)
		await wait(100)
		assert.equal(getState().settings.bubbleColor, "#123456")
		assert.equal(
			await js(pet, 'document.getElementById("bubble").style.getPropertyValue("--bubble-color")'),
			"#123456",
		)
		const darkBubbleStyle = await keyBubbleColors()
		assert.notEqual(darkBubbleStyle.text, "rgb(83, 45, 18)")
		assert.equal(darkBubbleStyle.border, darkBubbleStyle.text)
		await js(studio, "window.petAPI.command('settings',{bubbleColor:'#ffb6c1'})")
		await wait(100)
		assert.equal(getState().settings.bubbleColor, "#ffb6c1")
		const pinkBubbleStyle = await keyBubbleColors()
		assert.notEqual(pinkBubbleStyle.text, "rgb(83, 45, 18)")
		assert.equal(pinkBubbleStyle.border, pinkBubbleStyle.text)
		await js(studio, "window.petAPI.command('settings',{bubbleColor:'#ffd26f'})")
		await wait(100)
		assert.equal(
			await js(studio, 'document.querySelectorAll("#keyboardLabelsRows .keyboard-label-row").length'),
			Object.keys(getState().settings.keyLabels).length,
		)
		await js(
			studio,
			'document.querySelectorAll("#settingsRows [role=tab]")[2].click();[...document.querySelectorAll("#settingsRows button")].find(button=>button.textContent==="Edit Labels").click()',
		)
		await wait(100)
		assert.equal(
			await js(
				studio,
				'(()=>{const button=document.querySelector("#keyboardLabelsRows .keyboard-label-add"),page=document.querySelector("#page-keyboard-labels");return button.getBoundingClientRect().bottom<=page.getBoundingClientRect().bottom;})()',
			),
			true,
		)
		await js(studio, 'document.querySelector("#keyboardLabelsRows .keyboard-label-add").click()')
		await js(
			studio,
			'document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"a",code:"KeyA",bubbles:true,cancelable:true}))',
		)
		await wait(100)
		// The captured key is appended after the default labels.
		assert.equal(
			await js(
				studio,
				'[...document.querySelectorAll("#keyboardLabelsRows [data-label-field=key]")].at(-1)?.value',
			),
			"A",
		)
		assert.equal(await js(studio, 'document.activeElement?.getAttribute("data-label-field")'), "value")
		await js(studio, '[...document.querySelectorAll("#keyboardLabelsRows .keyboard-label-remove")].at(-1).click()')
		await wait(150)
		assert.equal(getState().settings.keyLabels.A, undefined)
		await openPage("collection")
		results.push("Initial 11 items, layered character images, and 42-key layout")
		await capture("collection", studio)
		await capture("pet", pet)

		if (process.argv.includes("--snapshot")) {
			// Snapshots show the pet as people see it: opaque (an earlier step dragged the opacity down)
			// and with its keyboard. Toggling the keyboard reloads the pet page.
			await js(studio, "window.petAPI.command('settings',{opacity:1,showKeyboard:true})")
			await wait(2000)
			await js(studio, "window.petAPI.command('settings',{holdAnimation:true})")
			input("Q", true, "left")
			input("P", true, "right")
			await wait(100)
			// The most recent key that is held decides the hand.
			assert.equal((await petTest()).action, 3)
			await capture("pet-both-hands", pet)
			input("P", false)
			await wait(80)
			assert.equal((await petTest()).action, 2)
			input("Q", false)
			await wait(80)
			assert.equal((await petTest()).action, 1)
			await js(studio, "window.petAPI.command('settings',{holdAnimation:false})")
			await js(studio, "window.petAPI.command('settings',{hoverFade:false})")
			await js(
				pet,
				"document.getElementById('counter').textContent='999';document.getElementById('counter').click()",
			)
			await wait(850)
			await capture("pet-menu", pet)
			await js(studio, "window.petAPI.command('emote'," + JSON.stringify(getState().emotes[0]) + ")")
			await wait(50)
			await js(
				pet,
				"for(const a of document.querySelector('.local-emotion-bubble').getAnimations()){a.pause();a.currentTime=350;}",
			)
			await capture("pet-emote", pet)
			await js(
				studio,
				"document.querySelector('[data-page=atlas]').click();document.querySelector('[data-type=emote]').click()",
			)
			await capture("emote-atlas", studio)
			fs.writeFileSync(
				out + "/visual.json",
				JSON.stringify(
					await js(
						pet,
						"({toolbar:(()=>{const e=document.querySelector('.pet-toolbar'),r=e.getBoundingClientRect(),s=getComputedStyle(e);return{width:r.width,height:r.height,background:s.backgroundImage};})(),bubbles:document.querySelectorAll('.local-emotion-bubble').length})",
					),
					null,
					2,
				),
			)
			return
		}

		await js(
			studio,
			"document.querySelector('[data-page=draw]').click();document.querySelector('[data-draw=\"10\"]').click()",
		)
		studio.show()
		studio.focus()
		pet.showInactive()
		await wait(1800)
		assert.equal(getState().draws, 10)
		assert.equal(await js(studio, 'document.querySelectorAll(".result-card").length'), 10)
		try {
			await capture("ten-draw", studio)
		} catch {}
		results.push("Ten-draw screen, ten results, and new items saved")
		await js(
			studio,
			"document.getElementById('closeResults').click();document.querySelector('[data-draw=\"1\"]').click()",
		)
		await wait(500)
		assert.equal(getState().draws, 11)
		assert.equal(await js(studio, 'document.querySelectorAll(".result-card").length'), 1)
		results.push("Single-draw screen")
		await js(studio, "document.getElementById('closeResults').click()")
		const male = items.find(x => x.starter && x.roleId === 1501)
		await js(studio, `window.petAPI.command('equip',${JSON.stringify(male.id)})`)
		await wait(400)
		assert.equal((await petTest()).character, male.id)
		await js(studio, "document.querySelector('#miniPresets .preset-item--add').click()")
		await wait(100)
		assert.equal(await js(studio, '!!document.querySelector("#presetsRoot #presetName")'), true)
		assert.equal(await js(studio, '!!document.querySelector("#presetsRoot #presets")'), true)
		await openPage("synthesis")
		await wait(100)
		assert.equal(await js(studio, 'document.querySelectorAll("#synthesisRoot [data-synth-mode]").length'), 2)
		assert.equal(await js(studio, 'document.querySelectorAll("#synthesisRoot [data-synth-count]").length'), 2)
		assert.equal(await js(studio, '!!document.querySelector("#materialPicker #materialGroups")'), true)
		await openPage("collection")
		results.push("Outfit changes sync to the desktop pet")
		await js(studio, "document.getElementById('savePreset').click()")
		await wait(250)
		assert.equal(getState().presets.length, 1)
		const temporaryPreset = getState().presets[0]
		await js(studio, `window.petAPI.command('preset-delete',${JSON.stringify(temporaryPreset.id)})`)
		await wait(100)
		await openPage("synthesis")
		await wait(100)
		await js(studio, "document.querySelector('#synthesisSlots .synthesis-item').click()")
		await wait(100)
		assert.equal(await js(studio, "document.getElementById('materialPicker').open"), true)
		await js(studio, "document.getElementById('closeMaterials').click()")
		await wait(100)
		await openPage("collection")
		const before = getState().count
		input("A", true, "left")
		await wait(50)
		assert.equal((await petTest()).action, 2)
		assert.equal(await js(pet, 'document.querySelector(\'[data-key="A"]\').classList.contains("active")'), true)
		input("A", false)
		await wait(200)
		assert.equal(getState().count, before + 1)
		assert.equal((await petTest()).action, 1)
		assert.equal(await js(pet, 'document.querySelector(\'[data-key="A"]\').classList.contains("active")'), false)
		results.push("Input events, tap animation, reset, and counter")

		await js(studio, "window.petAPI.command('settings',{holdAnimation:true})")
		await wait(80)
		input("R", true, "left")
		await wait(250)
		assert.equal((await petTest()).action, 2)
		input("F", true, "right")
		await wait(80)
		assert.equal((await petTest()).action, 3)
		input("F", false)
		await wait(80)
		assert.equal((await petTest()).action, 2)
		input("R", false)
		await wait(80)
		assert.equal((await petTest()).action, 1)
		await js(studio, "window.petAPI.command('settings',{holdAnimation:false})")
		results.push("Latest held input animates and earlier held input resumes on release")

		getState().count = 998
		input("Q", true, "left")
		input("Q", true, "left")
		assert.equal(getState().count, 999)
		input("Q", false)
		input("W", true, "left")
		input("W", true, "left")
		await wait(80)
		assert.equal(getState().count, 0)
		assert.equal((await petTest()).count, "0")
		const popped = await js(pet, "[...document.querySelectorAll('.local-emotion-bubble')].map(x=>x.dataset.emote)")
		assert.equal(popped.length, 1)
		assert(getState().emotes.includes(popped[0]))
		input("W", false)
		assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "collection.json"), "utf8")).count, 0)
		assert.equal(
			await js(pet, "getComputedStyle(document.querySelector('.local-emotion-bubble__img')).width"),
			"80px",
		)
		assert.equal(
			await js(pet, "getComputedStyle(document.querySelector('.local-emotion-bubble')).animationDuration"),
			"1s",
		)
		await wait(1250)
		assert.equal(await js(pet, "document.querySelectorAll('.local-emotion-bubble').length"), 0)
		await js(pet, "document.getElementById('counter').click()")
		await wait(800)
		assert.equal(await js(pet, "getComputedStyle(document.querySelector('.emotion-img')).width"), "30px")
		const sourcePaths = await js(
			pet,
			"[...document.querySelectorAll('.emotion-img')].map(x=>x.getAttribute('src'))",
		)
		assert(
			sourcePaths.every(src =>
				getState().emotes.some(id => items.find(x => x.id === id).image === src.replace(/^\.\.\//, "")),
			),
		)
		results.push(
			"Counter wraps 998 → 999 → 0; held keys do not repeat; only equipped emotes float; original 80px/1s animation and 30px interactive assets",
		)
		await js(studio, "window.petAPI.command('settings',{alwaysOnTop:false})")
		assert.equal(getState().settings.alwaysOnTop, false)
		assert.equal(pet.isAlwaysOnTop(), false)
		await js(studio, "window.petAPI.command('settings',{alwaysOnTop:true})")
		assert.equal(getState().settings.alwaysOnTop, true)
		assert(pet.isAlwaysOnTop())
		results.push("Always-on-top can be toggled off and on")

		await js(studio, `window.petAPI.command('emote',${JSON.stringify(getState().emotes[0])})`)
		await wait(200)
		assert((await petTest()).bubble)
		results.push("Emote bubble")
		await js(studio, "window.petAPI.command('preset-save','Test Outfit')")
		assert.equal(getState().presets.length, 1)
		results.push("Preset saved")
		getState().owned[male.id] = 101
		const synth = await js(studio, "window.petAPI.command('synthesize',{n:10,rarity:'common'})")
		assert(synth.ok)
		assert.equal(synth.result.length, 10)
		assert(getState().owned[male.id] >= 1)
		results.push("Ten-synthesis API keeps one copy")
		const offline = await js(studio, "fetch('https://example.com').then(()=>false).catch(()=>true)")
		assert(offline)
		results.push("Network requests are blocked while running")
		const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, "collection.json"), "utf8"))
		assert.equal(persisted.draws, 11)
		assert.equal(persisted.presets.length, 1)
		results.push("Disk save verified")
		await openPage("atlas")
		await wait(300)
		assert.equal((await studioTest()).groupCount, 4)
		await capture("atlas", studio)

		const inventoryBox = await js(
			studio,
			"(()=>{const e=document.getElementById('inventory'),r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,client:e.clientHeight,scroll:e.scrollHeight,bottom:r.bottom};})()",
		)
		assert(
			inventoryBox.client > 80 && inventoryBox.scroll > inventoryBox.client,
			"Atlas must have a bounded scroll viewport",
		)
		assert(inventoryBox.bottom <= studio.getContentBounds().height + 1)
		const wheel = {
			type: "mouseWheel",
			x: Math.round(inventoryBox.x + inventoryBox.width / 2),
			y: Math.round(inventoryBox.y + Math.min(80, inventoryBox.height / 2)),
			deltaX: 0,
			deltaY: -400,
			canScroll: true,
		} as const
		studio.show()
		studio.focus()
		studio.webContents.focus()
		await wait(200)
		studio.webContents.sendInputEvent({
			type: "mouseMove",
			x: wheel.x,
			y: wheel.y,
		})
		for (let i = 0; i < 4 && (await js(studio, "document.getElementById('inventory').scrollTop")) === 0; i++) {
			studio.webContents.sendInputEvent(wheel)
			await wait(500)
		}
		assert(
			await js(studio, "document.getElementById('inventory').scrollTop>0"),
			"Real wheel input must scroll the atlas",
		)
		results.push("Atlas categories are height-constrained and scroll with real wheel input")

		assert((await studioTest()).visibleCards <= 50, "Only nearby cards should be mounted, not all 899")
		await js(
			studio,
			"document.getElementById('inventory').scrollTop=document.getElementById('inventory').scrollHeight",
		)
		await wait(100)
		for (
			let i = 0;
			i < 30 &&
			!(await js(studio, "document.querySelector('#inventory .atlas-group:last-of-type .item-card')!==null"));
			i++
		)
			await wait(100)
		assert((await studioTest()).visibleCards <= 50)
		assert(
			await js(studio, "document.querySelector('#inventory .atlas-group:last-of-type .item-card')!==null"),
			"Scrolling to the end must render the last rarity group",
		)
		await js(studio, "document.getElementById('inventory').scrollTop=0")
		await wait(100)
		results.push("The 899-item atlas mounts at most 50 nearby cards and reaches the final group")

		await js(studio, "document.querySelector('[data-type=character]').click()")
		assert.equal((await studioTest()).filterCount, 3)

		assert.equal((await studioTest()).loadedCards, 260)
		assert(await js(studio, "!document.getElementById('loadMore')"))
		assert((await studioTest()).visibleCards <= 50, "Virtualized rendering should keep only nearby cards mounted")
		await js(studio, "window.petAPI.command('favorite',document.querySelector('#inventory .item-card').dataset.id)")
		assert.equal((await studioTest()).loadedCards, 260)
		await js(studio, "document.querySelector('[data-type=emote]').click()")
		assert.equal((await studioTest()).loadedCards, 504)
		assert(
			await js(
				studio,
				"new Set([...document.querySelectorAll('#inventory .item-card')].map(x=>x.dataset.id)).size<=50",
			),
		)
		await js(studio, "document.querySelector('[data-type=character]').click()")
		assert.equal((await studioTest()).loadedCards, 260)
		results.push(
			"Filtering 260 characters or 504 emotes loads the full result; virtualization mounts nearby cards only",
		)

		const originalBounds = studio.getBounds()
		studio.setBounds({ ...originalBounds, width: 820, height: 600 })
		await wait(200)
		await js(
			studio,
			"document.querySelector('[data-type=emote]').click();document.querySelector('[data-filter=role] .select-input').click()",
		)
		const popup = await js(
			studio,
			"(()=>{const e=document.querySelector('.select-option:popover-open'),r=e.getBoundingClientRect(),l=e.firstElementChild;return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,scroll:l.scrollHeight,client:l.clientHeight,text:l.innerText};})()",
		)
		assert(popup.x >= 0 && popup.y >= 0 && popup.right <= popup.width + 1 && popup.bottom <= popup.height + 1)
		assert(popup.scroll > popup.client)
		assert(popup.text.includes("Encore"))
		await capture("role-dropdown-small", studio)
		await js(studio, "document.querySelector('[data-window=larger]').click()")
		await wait(200)
		assert(studio.getBounds().width > 820)
		await js(studio, "document.querySelector('[data-window=smaller]').click()")
		await wait(200)
		assert(studio.getBounds().width < 902)
		await js(studio, "document.querySelector('[data-window=maximize]').click()")
		await wait(200)
		assert(studio.getBounds().width >= 820)
		await js(studio, "document.querySelector('[data-window=maximize]').click()")
		await wait(200)
		assert(studio.getBounds().width <= 902)
		studio.setBounds(originalBounds)
		await wait(150)
		await js(
			studio,
			"document.querySelector('[data-page=collection]').click();document.querySelector('[data-type=emote]').click()",
		)
		const replacement = items.find(x => x.starter && x.type === "emote" && !getState().emotes.includes(x.id))
		await js(studio, "document.querySelector('[data-id=\"" + replacement.id + "\"]').click()")
		assert(await js(studio, "document.getElementById('emotePicker').open"))
		assert.equal(await js(studio, "document.querySelectorAll('.emote-replace-slot').length"), 5)
		await js(studio, "document.querySelector('.emote-replace-slot[data-slot=\"2\"]').click()")
		await wait(200)
		assert.equal(getState().emotes[2], replacement.id)
		assert.equal(getState().emotes.length, 5)
		assert.equal(
			await js(pet, "document.querySelectorAll('.emotion-img')[2].getAttribute('src')"),
			"../" + replacement.image,
		)

		const nextEmote = items.find(x => x.starter && x.type === "emote" && !getState().emotes.includes(x.id))
		await js(studio, "document.querySelectorAll('#previewEmotes button')[2].click()")
		assert.equal((await studioTest()).replaceSlot, 2)
		assert.equal((await studioTest()).type, "emote")
		assert.equal((await studioTest()).filterCount, 2)
		assert(
			await js(
				studio,
				"!document.getElementById('replaceBar').hidden&&!document.getElementById('emotePicker').open",
			),
		)
		await js(studio, "document.querySelector('[data-filter=role] .select-input').click()")
		await capture("emote-slot-picker", studio)
		await js(
			studio,
			"document.querySelector('[data-filter=role] [data-value=\"" + nextEmote.roleId + "\"]').click()",
		)
		await js(
			studio,
			"document.querySelector('[data-filter=rarity] [data-value=\"" + nextEmote.rarity + "\"]').click()",
		)
		assert(
			await js(
				studio,
				"[...document.querySelectorAll('#inventory .item-card')].every(e=>e.dataset.id.startsWith('emote:'))",
			),
		)
		await js(studio, "document.querySelector('[data-id=\"" + nextEmote.id + "\"]').click()")
		await wait(300)
		assert.equal(getState().emotes[2], nextEmote.id)
		assert.equal(
			await js(pet, "document.querySelectorAll('.emotion-img')[2].getAttribute('src')"),
			"../" + nextEmote.image,
		)
		assert.equal((await studioTest()).replaceSlot, null)
		results.push(
			"Click emote slot 3, filter by character or rarity, select a replacement, and confirm it syncs to the pet",
		)

		const idleBefore = await js(pet, "emotionMotion.ticks")
		await wait(600)
		assert.equal(await js(pet, "emotionMotion.ticks"), idleBefore)
		results.push(
			"Dropdowns fit small windows; resize and maximize restore work; replace an emote with five equipped; idle animation does not keep refreshing",
		)
		await js(
			studio,
			"document.querySelector('[data-page=atlas]').click();document.querySelector('[data-type=character]').click()",
		)

		await js(studio, "document.querySelector('[data-filter=series] .select-input').click()")
		await wait(200)
		await capture("filters", studio)
		await js(studio, "document.querySelector('[data-filter=series] [data-value=\"1007\"]').click()")
		assert.equal((await studioTest()).loadedCards, 10)
		await js(studio, "document.querySelector('[data-filter=role] [data-value=\"1107\"]').click()")
		assert.equal((await studioTest()).loadedCards, 1)
		results.push("Rarity groups, seven series, 55 character indexes, and combined series/character filters")
		await openPage("synthesis")
		await wait(200)
		assert.equal(await js(studio, 'document.querySelectorAll(".synthesis-item").length'), 10)
		await capture("synthesis", studio)
		await js(studio, "document.querySelector('[data-synth-mode=same]').click()")
		assert.equal(await js(studio, 'document.querySelectorAll(".synthesis-item").length'), 5)
		results.push("Upgrade uses ten slots; same-tier uses five; single and ten-count buttons")
		await openPage("settings")
		await wait(200)
		try {
			await capture("settings", studio)
		} catch {}
		assert(await js(studio, "!!document.getElementById('unlockAll')&&!!document.getElementById('resetData')"))
		await js(studio, "document.getElementById('unlockAll').click()")
		await wait(100)
		assert.equal(Object.keys(getState().owned).filter(k => getState().owned[k] > 0).length, items.length)
		await js(studio, "window.confirm=()=>true;document.getElementById('resetData').click()")
		await wait(300)
		assert.equal(
			Object.keys(getState().owned).filter(k => getState().owned[k] > 0).length,
			items.filter(x => x.starter).length,
		)
		assert.equal(getState().draws, 0)
		assert.equal(getState().count, 0)
		results.push("Settings Unlock All mở đủ 899 món, Reset khôi phục collection mặc định")
		assert.equal(errors.filter(e => !e.includes("Content Security Policy")).length, 0)
		fs.writeFileSync(
			out + "/result.json",
			JSON.stringify({ ok: true, results, errors, hook: global.__QA.hook() }, null, 2),
		)
		console.log("QA_SUCCESS " + JSON.stringify(results))
	} catch (e) {
		try {
			console.log("FAILED_STATE", await studioTest())
			await capture("failure", studio)
		} catch {}
		fs.writeFileSync(out + "/result.json", JSON.stringify({ ok: false, results, error: e.stack, errors }, null, 2))
		console.error("QA_FAILED", e)
	} finally {
		await wait(100)
		app.quit()
	}
}
