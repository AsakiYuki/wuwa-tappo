import { isMac } from "../../../shared/assets"
import type { Settings } from "../../../shared/types"

export type SettingsTab = "general" | "pet" | "input" | "bubbles" | "data"

export type BooleanSettingKey = {
	[Key in keyof Settings]: Settings[Key] extends boolean ? Key : never
}[keyof Settings]

export type RangeSettingKey = "opacity" | "scale" | "bubbleLifetime"

export const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
	{ id: "general", label: "General" },
	{ id: "pet", label: "Pet" },
	{ id: "input", label: "Input" },
	{ id: "bubbles", label: "Bubbles" },
	{ id: "data", label: "Data" },
]

export interface RangeSpec {
	key: RangeSettingKey
	title: string
	min: number
	max: number
	step: number
	unit: "percent" | "seconds"
}

export const RANGES: Record<RangeSettingKey, RangeSpec> = {
	opacity: { key: "opacity", title: "Pet Opacity", min: 0.3, max: 1, step: 0.05, unit: "percent" },
	scale: { key: "scale", title: "Pet Scale", min: 0.65, max: 1.5, step: 0.05, unit: "percent" },
	bubbleLifetime: { key: "bubbleLifetime", title: "Bubble Lifetime", min: 0.5, max: 3, step: 0.25, unit: "seconds" },
}

export interface SwitchSpec {
	key: BooleanSettingKey
	title: string
	tab: SettingsTab
	description?: string
}

const SWITCHES: SwitchSpec[] = [
	{ key: "autoStart", title: "Launch at Startup", tab: "general" },
	{ key: "lockDrag", title: "Lock Pet Position", tab: "pet", description: "Prevents moving the pet by dragging." },
	{
		key: "hoverFade",
		title: "Fade on Hover",
		tab: "pet",
		description: "Pet becomes semi-transparent when mouse hovers over it.",
	},
	{
		key: "showChest",
		title: "Always Show Chest",
		tab: "pet",
		description: "Always show chest shortcut next to pet.",
	},
	{ key: "showKeyboard", title: "Show Keyboard", tab: "pet" },
	{
		key: "autoEmote",
		title: "Auto Emote on Key Taps",
		tab: "bubbles",
		description: "Show a random equipped emote after the counter wraps.",
	},
	{
		key: "showPressedKeys",
		title: "Show Pressed Keys",
		tab: "bubbles",
		description: "Highlight keyboard keys while they are being held.",
	},
	{
		key: "showMouseBubbles",
		title: "Show Mouse Bubbles",
		tab: "bubbles",
		description: "Show a bubble when a mouse button is pressed.",
	},
	{ key: "counterLeft", title: "Move Counter to Left", tab: "pet" },
	{ key: "alwaysOnTop", title: "Always On Top", tab: "general" },
	{ key: "inputEnabled", title: "Keyboard & Mouse Reaction", tab: "input" },
	{
		key: "touchpadInput",
		title: "Touchpad Touch Input",
		tab: "input",
		description: "React when a finger touches a Linux touchpad.",
	},
	{
		key: "holdAnimation",
		title: "Hold Animation",
		tab: "input",
		description: "Keep the hand animation active until the key or button is released.",
	},
	{
		key: "passthrough",
		title: "Mouse Passthrough",
		tab: "input",
		description: isMac ? "Press Command+Option+P to toggle." : "Press Ctrl+Alt+P to toggle.",
	},
]

export const switchesFor = (tab: SettingsTab) => SWITCHES.filter(spec => spec.tab === tab)

export const HAND_ANIMATIONS: Array<{ value: Settings["handAnimation"]; label: string }> = [
	{ value: "adaptive", label: "Adaptive" },
	{ value: "alternate", label: "Alternate" },
	{ value: "random", label: "Random" },
	{ value: "right", label: "Right Hand" },
	{ value: "left", label: "Left Hand" },
]

export const CONTROLLER_STYLES: Array<{ value: Settings["controllerStyle"]; label: string }> = [
	{ value: "xbox", label: "Xbox" },
	{ value: "ps", label: "PlayStation" },
]

export const COUNTER_TOKENS = "<CPS>, <CPS_ALL>, <LMB_CPS>, <MMB_CPS>, <RMB_CPS>, <DAY_COUNT>, <TOTAL_COUNT>"
export const DEFAULT_COUNTER_LIMIT = 999
