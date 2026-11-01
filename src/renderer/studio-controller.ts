import { getItemName } from "./names"
import { labels } from "./studio/constants"
import { type InventoryFilters, type InventoryPage, type InventoryType } from "./studio/collection"
import { createElement as el, createImage as img, byId as $, createToast } from "./studio/dom"
import { mountSettingsPanel } from "./studio/settings-panel"
import { mountSynthesisPanel } from "./studio/synthesis-panel"
import { mountPresetsPanel } from "./studio/presets-panel"
import { mountInventoryPanel } from "./studio/inventory-panel"
import { mountOutfitPreview } from "./studio/outfit-preview"
import { mountResultsPanel } from "./studio/results-panel"
import type { CatalogItem, PetState } from "./types"

declare const __APP_VERSION__: string
declare const __BUILD_VERSION__: string

export function mountStudioController() {
	const toast = createToast()
	let replaceSlot: number | null = null
	let state!: PetState,
		items: CatalogItem[],
		filterMeta: {
			series: Record<string, string>
			roles: Record<string, string>
		},
		map = new Map<string, CatalogItem>(),
		page: InventoryPage = "collection",
		type: InventoryType = "all",
		filters: InventoryFilters = { series: "all", role: "all", rarity: "all" }
	async function command(name: string, arg?: unknown) {
		const r = await window.petAPI.command(name, arg)
		if (!r.ok) toast(r.error)
		if (r.warning) toast(r.warning)
		return r
	}
	function navigate(p) {
		replaceSlot = null
		page = p
		for (const k of ["collection", "draw", "synthesis", "presets", "settings", "keyboard-labels"])
			$("page-" + k).hidden = k !== (p === "atlas" ? "collection" : p)
		document
			.querySelectorAll<any>("[data-page]")
			.forEach(b =>
				b.classList.toggle(
					"tab-btn--active",
					b.dataset.page === p ||
						(p === "presets" && b.dataset.page === "collection") ||
						(p === "keyboard-labels" && b.dataset.page === "settings"),
				),
			)
		$("currentOutfit").hidden = p === "atlas"
		$("page-collection").classList.toggle("role-panel", p !== "atlas")
		$("allTab").textContent = p === "atlas" ? "All" : "Recent"
		type = "all"
		filters = { series: "all", role: "all", rarity: "all" }
		document.querySelectorAll<any>("[data-type]").forEach(b => b.classList.toggle("selected", b.dataset.type === type))
		render()
		$("inventory").scrollTop = 0
	}
	document.querySelectorAll<any>("[data-page]").forEach(b => (b.onclick = () => navigate(b.dataset.page)))
	for (const id of ["hidePanel", "closePanel"]) $(id).onclick = () => command("hide")
	function equipped(it) {
		return it.type === "character"
			? state.character === it.id
			: it.type === "accessory"
				? state.accessory === it.id
				: state.emotes.includes(it.id)
	}
	function card(it, interactive = true) {
		const owned = state.owned[it.id] || 0,
			kind = it.type === "character" ? "character_skin" : it.type,
			c = el(
				"article",
				"atlas-item item-card atlas-item--" +
					kind +
					(!owned ? " atlas-item--unowned" : "") +
					(equipped(it) && page !== "atlas" ? " atlas-item--active" : ""),
			)
		c.dataset.id = it.id
		const titleName = getItemName(it)
		c.title = titleName + " · " + labels[it.rarity]
		const art = el("div", "atlas-thumb atlas-thumb--" + it.rarity)
		art.append(img(it.thumbnail))
		const name = el("div", "atlas-name")
		name.append(el("div", "atlas-name-inner", titleName))
		c.append(art, name, el("span", "atlas-type-icon"))
		if (owned > 1) c.append(el("span", "atlas-qty", String(owned)))
		if (interactive) {
			const fav = el("button", "atlas-collect" + (state.favorites.includes(it.id) ? " atlas-collect--active" : ""))
			fav.title = "Favorite / Unfavorite"
			fav.onclick = e => {
				e.stopPropagation()
				command("favorite", it.id)
			}
			c.append(fav)
			c.tabIndex = 0
			c.onclick = async () => {
				if (!owned) {
					toast("Obtain via chests or synthesis")
					return
				}
				if (it.type === "emote" && replaceSlot !== null) {
					const slot = replaceSlot
					if ((await command("emote-replace", { id: it.id, slot })).ok) {
						replaceSlot = null
						render()
						toast("Emote " + (slot + 1) + " replaced with " + titleName)
					}
					return
				}
				if (it.type === "character") {
					if (equipped(it)) {
						toast(titleName + " is already equipped")
						return
					}
					const result = await command("equip", it.id)
					if (result.ok) {
						state.character = it.id
						render()
						toast("Equipped " + titleName)
					}
					return
				}
				if (it.type === "emote" && !equipped(it) && state.emotes.length >= 5) {
					chooseEmote(it)
					return
				}
				const result = await command("equip", it.id)
				if (result.ok) render()
			}
			c.onkeydown = e => {
				if (e.target === c && (e.key === "Enter" || e.key === " ")) {
					e.preventDefault()
					c.click()
				}
			}
			if (it.type === "emote" && owned)
				c.oncontextmenu = e => {
					e.preventDefault()
					command("emote", it.id)
				}
		}
		return c
	}
	const inventoryPanel = mountInventoryPanel({
		getItems: () => items,
		getState: () => state,
		getPage: () => page,
		getType: () => type,
		setType: nextType => {
			type = nextType
		},
		getFilters: () => filters,
		setFilters: nextFilters => {
			filters = nextFilters
		},
		getFilterMetadata: () => filterMeta,
		createCard: item => card(item),
	})
	const renderPreview = mountOutfitPreview({
		getState: () => state,
		getItem: id => map.get(id),
		getReplacementSlot: () => replaceSlot,
		chooseEmoteSlot,
		command,
		navigateToPresets: () => navigate("presets"),
	})
	function render() {
		if (!state || !items) return
		$("replaceBar").hidden = replaceSlot === null
		$("replaceHint").textContent =
			replaceSlot === null ? "" : "Replacing emote " + (replaceSlot + 1) + " · Select an owned emote below"
		renderPreview()
		if (page === "collection" || page === "atlas") {
			inventoryPanel.render()
		}
		if (page === "draw") {
			$("pity").textContent = "Epic pity in " + (50 - state.pity) + " pulls · Unlimited"
			$("drawTotal").textContent = "Total opened: " + state.draws.toLocaleString()
			$("history").replaceChildren()
			for (const h of state.history.slice(0, 20)) {
				const it = map.get(h.id)
				if (it) {
					const im = img(it.thumbnail)
					im.title = getItemName(it)
					$("history").append(im)
				}
			}
		}
		if (page === "synthesis") renderSynthesis()
		if (page === "presets") renderPresets()
		if (page === "settings" || page === "keyboard-labels") renderSettings(state.settings, monitorCount)
	}
	const resultsPanel = mountResultsPanel({
		getItem: id => map.get(id),
		createCard: (item, interactive) => card(item, interactive),
		command,
		toast,
	})
	const renderSynthesis = mountSynthesisPanel({
		api: window.petAPI,
		getItems: () => items,
		getState: () => state,
		showResults: resultsPanel.showSynthesisResults,
	})
	const renderPresets = mountPresetsPanel({
		getState: () => state,
		getItem: id => map.get(id),
		command,
		navigate: destination => navigate(destination),
	})
	let monitorCount = 1
	const renderSettings = mountSettingsPanel({
		container: $("settingsRows"),
		keyboardLabelsContainer: $("keyboardLabelsRows"),
		openKeyboardLabels: () => navigate("keyboard-labels"),
		api: window.petAPI,
		toast,
		confirmReset: () => confirm("Reset all collection data, counters, presets and settings? This cannot be undone."),
	})
	$("appVersion").textContent = `v${__APP_VERSION__}`
	$("buildVersion").textContent = `Build ${__BUILD_VERSION__}`
	$("backToSettings").onclick = () => navigate("settings")
	$("openFolder").onclick = () => command("folder")
	$("recenter").onclick = () => command("recenter")
	$("quit").onclick = () => command("quit")
	window.petAPI.onState(s => {
		state = s
		render()
	})
	window.petAPI.onStatus(s => {
		$("hookStatus").textContent = s.hook
		if (s.warning) toast(s.warning)
	})
	window.petAPI.onPage(p => navigate(p))

	function chooseEmoteSlot(slot) {
		navigate("collection")
		replaceSlot = Math.min(slot, state.emotes.length)
		type = "emote"
		document.querySelectorAll<any>("[data-type]").forEach(b => b.classList.toggle("selected", b.dataset.type === type))
		render()
		$("inventory").scrollTop = 0
	}
	$("cancelReplace").onclick = () => {
		replaceSlot = null
		render()
	}

	function chooseEmote(it) {
		$("emotePickerTip").textContent = "Click a slot below to equip the selected emote."
		$("emotePickerTitle").textContent = "Equip " + getItemName(it)
		$("emoteSlots").replaceChildren()
		for (let slot = 0; slot < 5; slot++) {
			const old = map.get(state.emotes[slot]),
				b = el("button", "emote-replace-slot")
			b.dataset.slot = slot
			if (old) b.append(img(old.image))
			b.append(el("span", "", String(slot + 1) + " · " + (old ? getItemName(old) : "Empty Slot")))
			b.onclick = async () => {
				const result = await command("emote-replace", { id: it.id, slot })
				if (result.ok) {
					$("emotePicker").close()
					toast("Replaced emote " + (slot + 1))
				}
			}
			$("emoteSlots").append(b)
		}
		$("emotePicker").showModal()
	}
	$("closeEmotePicker").onclick = () => $("emotePicker").close()
	document.querySelectorAll<any>("[data-window]").forEach(b => (b.onclick = () => command("window", b.dataset.window)))
	$("panelDrag").ondblclick = () => command("window", "maximize")
	for (const edge of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) {
		const h = el("div", "resize-handle resize-" + edge)
		let drag = null
		h.onpointerdown = e => {
			if (e.button !== 0) return
			e.preventDefault()
			drag = { x: e.screenX, y: e.screenY }
			h.setPointerCapture(e.pointerId)
		}
		h.onpointermove = e => {
			if (!drag) return
			const dx = e.screenX - drag.x,
				dy = e.screenY - drag.y
			drag = { x: e.screenX, y: e.screenY }
			window.petAPI.resizeWindow(edge, dx, dy)
		}
		h.onpointerup = h.onpointercancel = () => {
			drag = null
		}
		$("resizeHandles").append(h)
	}

	function resize() {
		inventoryPanel.closeFilters()
		const scale = Math.min(innerWidth / 1100, innerHeight / 756),
			root = $("replicaRoot")
		root.style.transform = "scale(" + scale + ")"
		root.style.left = Math.max(0, (innerWidth - 1100 * scale) / 2) + "px"
		root.style.top = Math.max(0, (innerHeight - 756 * scale) / 2) + "px"
	}
	addEventListener("resize", resize)
	resize()
	window.petAPI.init().then(d => {
		state = d.state
		items = d.items
		filterMeta = d.filters
		map = new Map(items.map(x => [x.id, x]))
		monitorCount = d.monitors.length
		$("hookStatus").textContent = d.status.hook
		if (d.status.warning) toast(d.status.warning)
		render()
	})
	window.__studioTest = () => ({
		page,
		type,
		filters,
		replaceSlot,
		owned: Object.keys(state?.owned || {}).filter(k => state.owned[k] > 0).length,
		draws: state?.draws,
		count: state?.count,
		visibleCards: document.querySelectorAll<any>("#inventory .item-card").length,
		loadedCards: inventoryPanel.getItemCount(),
		filterCount: document.querySelectorAll<any>("#filterBar .select-item").length,
		groupCount: document.querySelectorAll<any>("#inventory .atlas-group").length,
		errors: [],
	})
}
