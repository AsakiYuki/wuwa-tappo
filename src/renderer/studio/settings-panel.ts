import type { PetAPI, PetSettings } from "../types"

interface SettingsPanelOptions {
	container: HTMLElement
	api: PetAPI
	toast(message: string): void
	confirmReset(): boolean
	version: string
}

type SettingKey = keyof PetSettings

const ranges = [
	{ key: "opacity", title: "Pet Opacity", min: 0.3, max: 1, step: 0.05 },
	{ key: "scale", title: "Pet Scale", min: 0.65, max: 1.5, step: 0.05 },
] as const

const switches: Array<{
	key: SettingKey
	title: string
	description?: string
}> = [
	{ key: "autoStart", title: "Launch at Startup" },
	{
		key: "lockDrag",
		title: "Lock Pet Position",
		description: "Prevents moving the pet by dragging.",
	},
	{
		key: "hoverFade",
		title: "Hover on Fade",
		description: "Pet becomes semi-transparent when mouse hovers over it.",
	},
	{
		key: "showChest",
		title: "Always Show Chest",
		description: "Always show chest shortcut next to pet.",
	},
	{ key: "showKeyboard", title: "Show Keyboard" },
	{ key: "counterLeft", title: "Move Counter to Left" },
	{ key: "alwaysOnTop", title: "Always On Top" },
	{ key: "inputEnabled", title: "Keyboard & Mouse Reaction" },
	{
		key: "holdAnimation",
		title: "Hold Animation",
		description: "Keep the hand animation active until the key or button is released.",
	},
	{
		key: "passthrough",
		title: "Mouse Passthrough",
		description: "Press Ctrl+Alt+P to toggle.",
	},
]

function element<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className = "",
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag)
	if (className) node.className = className
	if (text !== undefined) node.textContent = text
	return node
}

export function mountSettingsPanel({
	container,
	api,
	toast,
	confirmReset,
	version,
}: SettingsPanelOptions): (settings: PetSettings, monitorCount: number) => void {
	const addSwitch = (key: SettingKey, title: string, description?: string) => {
		const row = element("div", `setting-item${description ? " has-sub" : ""}`)
		const labelText = element("div")
		labelText.append(element("div", "setting-title", title))
		if (description) labelText.append(element("div", "setting-sub", description))

		const label = element("label", "setting-switch")
		const input = element("input")
		input.type = "checkbox"
		input.dataset.setting = key
		input.setAttribute("aria-label", title)
		label.append(input, element("span", "setting-slider"))
		row.append(labelText, label)
		container.append(row)
	}

	switches.slice(0, 6).forEach(({ key, title, description }) => addSwitch(key, title, description))

	for (const { key, title, min, max, step } of ranges) {
		const row = element("div", "setting-item")
		const content = element("div", "setting-content")
		const input = element("input", "setting-range")
		const value = element("span", "setting-value")
		input.type = "range"
		input.min = String(min)
		input.max = String(max)
		input.step = String(step)
		input.dataset.setting = key
		input.setAttribute("aria-label", title)
		value.id = `${key}Value`
		content.append(input, value)
		row.append(element("div", "setting-title", title), content)
		container.append(row)
	}

	const counterLimitRow = element("div", "setting-item has-sub")
	const counterLimitLabel = element("div")
	counterLimitLabel.append(
		element("div", "setting-title", "Counter Limit"),
		element("div", "setting-sub", "Reset the counter after this value, or keep counting."),
	)
	const counterLimitControls = element("div", "setting-content")
	const counterLimitInput = element("input", "setting-number")
	counterLimitInput.type = "number"
	counterLimitInput.min = "1"
	counterLimitInput.max = String(Number.MAX_SAFE_INTEGER)
	counterLimitInput.step = "1"
	counterLimitInput.id = "counterLimitInput"
	counterLimitInput.dataset.setting = "counterLimit"
	counterLimitInput.setAttribute("aria-label", "Counter Limit")
	const unlimitedLabel = element("label", "setting-unlimited")
	const unlimitedInput = element("input")
	unlimitedInput.type = "checkbox"
	unlimitedInput.dataset.setting = "counterUnlimited"
	unlimitedInput.setAttribute("aria-label", "Unlimited Counter")
	unlimitedLabel.append(unlimitedInput, element("span", "", "Unlimited"))
	counterLimitControls.append(counterLimitInput, unlimitedLabel)
	counterLimitRow.append(counterLimitLabel, counterLimitControls)
	container.append(counterLimitRow)

	const displayRow = element("div", "setting-item has-sub")
	const displayText = element("div")
	displayText.append(
		element("div", "setting-title", "Display Screen:"),
		element("div", "setting-sub", "Press F8 to cycle"),
	)
	displayText.firstElementChild!.id = "monitorLabel"
	const cycleButton = element("button", "setting-btn", "Cycle Screen")
	cycleButton.onclick = () => void api.command("settings", { monitor: 0 })
	displayRow.append(displayText, cycleButton)
	container.append(displayRow)

	switches.slice(6).forEach(({ key, title, description }) => addSwitch(key, title, description))

	const handAnimationRow = element("div", "setting-item has-sub")
	const handAnimationLabel = element("div")
	handAnimationLabel.append(
		element("div", "setting-title", "Hand Animation"),
		element("div", "setting-sub", "Choose how the character moves its arms."),
	)
	const handAnimationSelect = element("select", "setting-select")
	handAnimationSelect.dataset.setting = "handAnimation"
	handAnimationSelect.setAttribute("aria-label", "Hand Animation")
	for (const [value, label] of [
		["adaptive", "Adaptive"],
		["alternate", "Alternate"],
		["random", "Random"],
		["right", "Right Hand"],
		["left", "Left Hand"],
	] as const) {
		const option = element("option", "", label)
		option.value = value
		handAnimationSelect.append(option)
	}
	handAnimationRow.append(handAnimationLabel, handAnimationSelect)
	container.append(handAnimationRow)

	const versionRow = element("div", "setting-item")
	const versionButton = element("button", "setting-btn", "Version Info")
	versionButton.onclick = () => toast(`Wuwa Tappo ${version}`)
	versionRow.append(element("div", "setting-title", `Current Version ${version}`), versionButton)
	container.append(versionRow)

	const dataRow = element("div", "setting-item has-sub")
	const dataDescription = element("div")
	dataDescription.append(
		element("div", "setting-title", "Collection Data"),
		element("div", "setting-sub", "Unlock every item or start over."),
	)
	const dataActions = element("div", "setting-content")
	const unlockButton = element("button", "setting-btn", "Unlock All")
	const resetButton = element("button", "setting-btn", "Reset")
	unlockButton.onclick = async () => {
		const result = await api.command("unlock-all")
		if (result.ok) toast("All characters, accessories and emotes unlocked")
	}
	resetButton.onclick = () => {
		if (confirmReset()) void api.command("reset-data")
	}
	dataActions.append(unlockButton, resetButton)
	dataRow.append(dataDescription, dataActions)
	container.append(dataRow)

	container.addEventListener("change", event => {
		const input = event.target
		if ((!(input instanceof HTMLInputElement) && !(input instanceof HTMLSelectElement)) || !input.dataset.setting)
			return
		if (input.dataset.setting === "counterUnlimited") {
			if (!(input instanceof HTMLInputElement)) return
			const limit = Number(counterLimitInput.value) || 999
			void api.command("settings", {
				counterLimit: input.checked ? null : limit,
			})
			return
		}
		const value =
			input instanceof HTMLInputElement && input.type === "checkbox"
				? input.checked
				: input instanceof HTMLSelectElement
					? input.value
					: Number(input.value)
		void api.command("settings", { [input.dataset.setting]: value })
	})

	return (settings, monitorCount) => {
		container
			.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-setting]:not([data-setting="counterUnlimited"])')
			.forEach(input => {
				const key = input.dataset.setting as SettingKey
				const value = settings[key]
				if (input instanceof HTMLSelectElement) {
					input.value = String(value)
					return
				}
				if (typeof value === "boolean") {
					input.checked = value
					return
				}
				if (typeof value !== "number") return
				input.value = String(value)
				if (input.type === "range")
					input.style.setProperty(
						"--range-progress",
						`${((value - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100}%`,
					)
			})
		if (settings.counterLimit !== null) counterLimitInput.value = String(settings.counterLimit)
		counterLimitInput.disabled = settings.counterLimit === null
		unlimitedInput.checked = settings.counterLimit === null
		container.querySelector<HTMLElement>("#scaleValue")!.textContent = `${Math.round(settings.scale * 100)}%`
		container.querySelector<HTMLElement>("#opacityValue")!.textContent = `${Math.round(settings.opacity * 100)}%`
		container.querySelector<HTMLElement>("#monitorLabel")!.textContent =
			`Display Screen: ${settings.monitor + 1} / ${monitorCount}`
		cycleButton.onclick = () =>
			void api.command("settings", {
				monitor: (settings.monitor + 1) % Math.max(1, monitorCount),
			})
	}
}
