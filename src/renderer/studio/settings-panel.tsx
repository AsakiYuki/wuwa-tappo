import { useEffect, useRef, useState, type CSSProperties } from "react"
import { createRoot } from "react-dom/client"
import { createPortal } from "react-dom"
import type { PetAPI, PetSettings } from "../types"

interface SettingsPanelOptions {
	container: HTMLElement
	keyboardLabelsContainer: HTMLElement
	openKeyboardLabels(): void
	api: PetAPI
	toast(message: string): void
	confirmReset(): boolean
}

type SettingKey = keyof PetSettings
type SettingsTab = "general" | "pet" | "input" | "bubbles" | "data"
type KeyLabelMode = "ui" | "json"
type KeyLabelRow = { id: string; key: string; value: string }

const tabs: Array<{ id: SettingsTab; label: string }> = [
	{ id: "general", label: "General" },
	{ id: "pet", label: "Pet" },
	{ id: "input", label: "Input" },
	{ id: "bubbles", label: "Bubbles" },
	{ id: "data", label: "Data" },
]

const ranges = [
	{ key: "opacity", title: "Pet Opacity", min: 0.3, max: 1, step: 0.05 },
	{ key: "scale", title: "Pet Scale", min: 0.65, max: 1.5, step: 0.05 },
	{ key: "bubbleLifetime", title: "Bubble Lifetime", min: 0.5, max: 3, step: 0.25 },
] as const

const switches: Array<{
	key: SettingKey
	title: string
	tab: SettingsTab
	description?: string
}> = [
	{ key: "autoStart", title: "Launch at Startup", tab: "general" },
	{ key: "lockDrag", title: "Lock Pet Position", tab: "pet", description: "Prevents moving the pet by dragging." },
	{
		key: "hoverFade",
		title: "Hover on Fade",
		tab: "pet",
		description: "Pet becomes semi-transparent when mouse hovers over it.",
	},
	{ key: "showChest", title: "Always Show Chest", tab: "pet", description: "Always show chest shortcut next to pet." },
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
		key: "holdAnimation",
		title: "Hold Animation",
		tab: "input",
		description: "Keep the hand animation active until the key or button is released.",
	},
	{ key: "passthrough", title: "Mouse Passthrough", tab: "input", description: "Press Ctrl+Alt+P to toggle." },
]

const builtInKeyLabels = new Set(["Meta", "Ctrl", "Alt", "Shift", "Tab", "CapsLock", "Backspace", "Enter", "Space"])

function createKeyLabelRows(labels: Record<string, string>): KeyLabelRow[] {
	return Object.entries(labels).map(([key, value], index) => ({ id: `${key}-${index}`, key, value }))
}

export function mountSettingsPanel(options: SettingsPanelOptions) {
	const { container, ...rootProps } = options
	const root = createRoot(container)
	return (settings: PetSettings, monitorCount: number) => {
		root.render(<SettingsPanelRoot {...rootProps} settings={settings} monitorCount={monitorCount} />)
	}
}

interface SettingsPanelRootProps extends Omit<SettingsPanelOptions, "container"> {
	settings: PetSettings
	monitorCount: number
}

function SettingsPanelRoot({ keyboardLabelsContainer, ...props }: SettingsPanelRootProps) {
	const [keyLabelMode, setKeyLabelMode] = useState<KeyLabelMode>("ui")
	return (
		<>
			<SettingsPanel {...props} setKeyLabelMode={setKeyLabelMode} />
			{createPortal(
				<KeyboardLabelsEditor
					labels={props.settings.keyLabels}
					mode={keyLabelMode}
					setMode={setKeyLabelMode}
					api={props.api}
					toast={props.toast}
				/>,
				keyboardLabelsContainer,
			)}
		</>
	)
}

interface SettingsPanelProps extends Omit<SettingsPanelOptions, "container" | "keyboardLabelsContainer"> {
	settings: PetSettings
	monitorCount: number
	setKeyLabelMode(mode: KeyLabelMode): void
}

function SettingsPanel({
	settings,
	monitorCount,
	openKeyboardLabels,
	api,
	toast,
	confirmReset,
	setKeyLabelMode,
}: SettingsPanelProps) {
	const [activeTab, setActiveTab] = useState<SettingsTab>("general")
	const [rangeValues, setRangeValues] = useState({
		opacity: settings.opacity,
		scale: settings.scale,
		bubbleLifetime: settings.bubbleLifetime,
	})
	const [counterLimitDraft, setCounterLimitDraft] = useState(String(settings.counterLimit ?? 999))
	const updateSetting = (key: SettingKey, value: unknown) => void api.command("settings", { [key]: value })

	useEffect(() => {
		setRangeValues({
			opacity: settings.opacity,
			scale: settings.scale,
			bubbleLifetime: settings.bubbleLifetime,
		})
	}, [settings.opacity, settings.scale, settings.bubbleLifetime])

	useEffect(() => {
		setCounterLimitDraft(String(settings.counterLimit ?? 999))
	}, [settings.counterLimit])

	const renderSwitches = (tab: SettingsTab) =>
		switches
			.filter(setting => setting.tab === tab)
			.map(setting => (
				<SwitchSetting
					key={setting.key}
					settingKey={setting.key}
					title={setting.title}
					description={setting.description}
					checked={Boolean(settings[setting.key])}
					onChange={checked => updateSetting(setting.key, checked)}
				/>
			))

	const renderRange = (key: (typeof ranges)[number]["key"]) => {
		const setting = ranges.find(range => range.key === key)!
		const value = rangeValues[key]
		const progress = ((value - setting.min) / (setting.max - setting.min)) * 100
		const displayValue =
			key === "bubbleLifetime" ? `${value.toFixed(2).replace(/0$/, "")} s` : `${Math.round(value * 100)}%`

		return (
			<SettingRow key={key} title={setting.title}>
				<div className="setting-content">
					<input
						className="setting-range"
						data-setting={key}
						aria-label={setting.title}
						type="range"
						min={setting.min}
						max={setting.max}
						step={setting.step}
						value={value}
						style={{ "--range-progress": `${progress}%` } as CSSProperties}
						onChange={event => setRangeValues(previous => ({ ...previous, [key]: Number(event.currentTarget.value) }))}
						onPointerUp={event => updateSetting(key, Number(event.currentTarget.value))}
						onKeyUp={event => updateSetting(key, Number(event.currentTarget.value))}
					/>
					<span className="setting-value" id={`${key}Value`}>
						{displayValue}
					</span>
				</div>
			</SettingRow>
		)
	}

	const panels: Record<SettingsTab, React.ReactNode> = {
		general: (
			<>
				<SettingRow title="Application">
					<button className="setting-btn" id="quit" type="button" onClick={() => void api.command("quit")}>
						Quit App
					</button>
				</SettingRow>
				{renderSwitches("general")}
				<SettingRow
					title={`Display Screen: ${settings.monitor + 1} / ${monitorCount}`}
					titleId="monitorLabel"
					description="Press F8 to cycle"
				>
					<button
						className="setting-btn"
						type="button"
						onClick={() => updateSetting("monitor", (settings.monitor + 1) % Math.max(1, monitorCount))}
					>
						Cycle Screen
					</button>
				</SettingRow>
			</>
		),
		pet: (
			<>
				<SettingRow title="Pet Position">
					<button className="setting-btn" id="recenter" type="button" onClick={() => void api.command("recenter")}>
						Recenter Pet
					</button>
				</SettingRow>
				{renderSwitches("pet")}
				{renderRange("opacity")}
				{renderRange("scale")}
				<SettingRow title="Counter Limit" description="Reset the counter after this value, or keep counting.">
					<div className="setting-content">
						<input
							className="setting-number"
							id="counterLimitInput"
							data-setting="counterLimit"
							aria-label="Counter Limit"
							type="number"
							min="1"
							max={Number.MAX_SAFE_INTEGER}
							step="1"
							value={counterLimitDraft}
							disabled={settings.counterLimit === null}
							onChange={event => setCounterLimitDraft(event.currentTarget.value)}
							onBlur={() => {
								if (settings.counterLimit !== null) updateSetting("counterLimit", Number(counterLimitDraft) || 999)
							}}
						/>
						<label className="setting-unlimited">
							<input
								data-setting="counterUnlimited"
								aria-label="Unlimited Counter"
								type="checkbox"
								checked={settings.counterLimit === null}
								onChange={event =>
									updateSetting("counterLimit", event.currentTarget.checked ? null : Number(counterLimitDraft) || 999)
								}
							/>
							<span>Unlimited</span>
						</label>
					</div>
				</SettingRow>
			</>
		),
		input: (
			<>
				{renderSwitches("input")}
				<SettingRow title="Keyboard Labels" description="Customize the names shown for keyboard keys.">
					<button
						className="setting-btn"
						type="button"
						onClick={() => {
							setKeyLabelMode("ui")
							openKeyboardLabels()
						}}
					>
						Edit Labels
					</button>
				</SettingRow>
				<SettingRow title="Hand Animation" description="Choose how the character moves its arms.">
					<select
						className="setting-select"
						data-setting="handAnimation"
						aria-label="Hand Animation"
						value={settings.handAnimation}
						onChange={event => updateSetting("handAnimation", event.currentTarget.value)}
					>
						<option value="adaptive">Adaptive</option>
						<option value="alternate">Alternate</option>
						<option value="random">Random</option>
						<option value="right">Right Hand</option>
						<option value="left">Left Hand</option>
					</select>
				</SettingRow>
			</>
		),
		bubbles: (
			<>
				{renderSwitches("bubbles")}
				{renderRange("bubbleLifetime")}
				<SettingRow title="Bubble Color" description="Used for key and emote bubbles.">
					<input
						className="setting-color"
						data-setting="bubbleColor"
						aria-label="Bubble Color"
						type="color"
						value={settings.bubbleColor}
						onChange={event => updateSetting("bubbleColor", event.currentTarget.value)}
					/>
				</SettingRow>
				<SettingRow title="Controller Bubble Style" description="Choose Xbox or PlayStation button labels.">
					<select
						className="setting-select"
						data-setting="controllerStyle"
						aria-label="Controller Bubble Style"
						value={settings.controllerStyle}
						onChange={event => updateSetting("controllerStyle", event.currentTarget.value)}
					>
						<option value="xbox">Xbox</option>
						<option value="ps">PlayStation</option>
					</select>
				</SettingRow>
			</>
		),
		data: (
			<>
				<SettingRow title="Save Data" description="Open the folder containing your collection save.">
					<button className="setting-btn" id="openFolder" type="button" onClick={() => void api.command("folder")}>
						Open Save Folder
					</button>
				</SettingRow>
				<SettingRow title="Collection Data" description="Unlock every item or start over.">
					<div className="setting-content">
						<button
							className="setting-btn"
							type="button"
							onClick={async () => {
								const result = await api.command("unlock-all")
								if (result.ok) toast("All characters, accessories and emotes unlocked")
							}}
						>
							Unlock All
						</button>
						<button
							className="setting-btn"
							type="button"
							onClick={() => {
								if (confirmReset()) void api.command("reset-data")
							}}
						>
							Reset
						</button>
					</div>
				</SettingRow>
				<SettingRow
					title="Backup and Restore"
					description="Export or import your collection and settings as a JSON file."
				>
					<div className="setting-content">
						<button
							className="setting-btn"
							type="button"
							onClick={async () => {
								const result = await api.command("export-data")
								if (!result.ok) toast(result.error || "Data export failed")
								else if (result.result === "exported") toast("Data exported")
							}}
						>
							Export Data
						</button>
						<button
							className="setting-btn"
							type="button"
							onClick={async () => {
								if (!confirm("Importing replaces your current collection and settings. Continue?")) return
								const result = await api.command("import-data")
								if (!result.ok) toast(result.error || "Data import failed")
								else if (result.result === "imported") toast("Data imported")
							}}
						>
							Import Data
						</button>
					</div>
				</SettingRow>
			</>
		),
	}

	return (
		<>
			<div className="settings-tabs" role="tablist">
				{tabs.map(tab => (
					<button
						key={tab.id}
						className={activeTab === tab.id ? "active" : ""}
						type="button"
						role="tab"
						aria-selected={activeTab === tab.id}
						onClick={() => setActiveTab(tab.id)}
					>
						{tab.label}
					</button>
				))}
			</div>
			<div className="settings-tab-content">
				{tabs.map(tab => (
					<div key={tab.id} className="settings-tab-panel" role="tabpanel" hidden={activeTab !== tab.id}>
						{panels[tab.id]}
					</div>
				))}
			</div>
		</>
	)
}

function SettingRow({
	title,
	titleId,
	description,
	children,
}: {
	title: string
	titleId?: string
	description?: string
	children: React.ReactNode
}) {
	return (
		<div className={`setting-item${description ? " has-sub" : ""}`}>
			<div>
				<div className="setting-title" id={titleId}>
					{title}
				</div>
				{description && <div className="setting-sub">{description}</div>}
			</div>
			{children}
		</div>
	)
}

function SwitchSetting({
	settingKey,
	title,
	description,
	checked,
	onChange,
}: {
	settingKey: SettingKey
	title: string
	description?: string
	checked: boolean
	onChange(checked: boolean): void
}) {
	return (
		<SettingRow title={title} description={description}>
			<label className="setting-switch">
				<input
					data-setting={settingKey}
					type="checkbox"
					aria-label={title}
					checked={checked}
					onChange={event => onChange(event.currentTarget.checked)}
				/>
				<span className="setting-slider" />
			</label>
		</SettingRow>
	)
}

function KeyboardLabelsEditor({
	labels,
	mode,
	setMode,
	api,
	toast,
}: {
	labels: Record<string, string>
	mode: KeyLabelMode
	setMode(mode: KeyLabelMode): void
	api: PetAPI
	toast(message: string): void
}) {
	const [rows, setRows] = useState<KeyLabelRow[]>(() => createKeyLabelRows(labels))
	const [jsonDraft, setJsonDraft] = useState(() => JSON.stringify(labels, null, 2))
	const nextId = useRef(0)
	const rowsRef = useRef(rows)

	useEffect(() => {
		const nextRows = createKeyLabelRows(labels)
		rowsRef.current = nextRows
		setRows(nextRows)
		setJsonDraft(JSON.stringify(labels, null, 2))
	}, [labels])

	const saveRows = (nextRows = rowsRef.current) => {
		const nextLabels: Record<string, string> = {}
		for (const row of nextRows) {
			const key = row.key.trim()
			if (key) nextLabels[key] = row.value.trim() || key
		}
		void api.command("settings", { keyLabels: nextLabels })
	}

	const addRow = () => {
		const nextRows = [...rowsRef.current, { id: `new-${nextId.current++}`, key: "", value: "" }]
		rowsRef.current = nextRows
		setRows(nextRows)
	}

	const updateRow = (id: string, field: "key" | "value", value: string) => {
		const nextRows = rowsRef.current.map(row => (row.id === id ? { ...row, [field]: value } : row))
		rowsRef.current = nextRows
		setRows(nextRows)
	}

	const removeRow = (id: string) => {
		const nextRows = rowsRef.current.filter(row => row.id !== id)
		rowsRef.current = nextRows
		setRows(nextRows)
		saveRows(nextRows)
	}

	const saveJson = () => {
		try {
			const parsed: unknown = JSON.parse(jsonDraft || "{}")
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				void api.command("settings", { keyLabels: parsed })
				return
			}
			throw new Error("Not an object")
		} catch {
			toast('Use valid JSON like {"Meta":"Meta"}')
		}
	}

	return (
		<div className="keyboard-labels-editor">
			<div className="keyboard-label-mode">
				<button
					className={mode === "ui" ? "active" : ""}
					type="button"
					aria-pressed={mode === "ui"}
					onClick={() => setMode("ui")}
				>
					UI
				</button>
				<button
					className={mode === "json" ? "active" : ""}
					type="button"
					aria-pressed={mode === "json"}
					onClick={() => setMode("json")}
				>
					JSON
				</button>
			</div>
			<div className="keyboard-label-ui" hidden={mode !== "ui"}>
				<div className="setting-sub">Edit each key and its displayed label.</div>
				<div className="keyboard-label-rows">
					{rows.map(row => {
						const isBuiltIn = builtInKeyLabels.has(row.key)
						return (
							<div className="keyboard-label-row" key={row.id}>
								<input
									className="keyboard-label-input"
									aria-label="Key name"
									data-label-field="key"
									placeholder="Key name, e.g. Meta"
									value={row.key}
									readOnly={isBuiltIn}
									onChange={event => updateRow(row.id, "key", event.currentTarget.value)}
									onBlur={() => saveRows()}
								/>
								<input
									className="keyboard-label-input"
									aria-label="Displayed label"
									data-label-field="value"
									placeholder="Displayed label"
									value={row.value}
									onChange={event => updateRow(row.id, "value", event.currentTarget.value)}
									onBlur={() => saveRows()}
								/>
								<button
									className="common-btn keyboard-label-remove"
									aria-label={`Remove ${row.key || "key label"}`}
									type="button"
									hidden={isBuiltIn}
									onClick={() => removeRow(row.id)}
								>
									Remove
								</button>
							</div>
						)
					})}
				</div>
				<button className="common-btn keyboard-label-add" type="button" onClick={addRow}>
					Add Key
				</button>
			</div>
			<div className="keyboard-label-json" hidden={mode !== "json"}>
				<div className="setting-sub">
					Edit key labels as JSON, for example: {"{"}"Meta":"Meta"{"}"}.
				</div>
				<textarea
					className="setting-textarea"
					aria-label="Keyboard Labels JSON"
					rows={12}
					value={jsonDraft}
					onChange={event => setJsonDraft(event.currentTarget.value)}
					onBlur={saveJson}
				/>
			</div>
		</div>
	)
}
