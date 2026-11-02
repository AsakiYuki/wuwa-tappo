import { useState } from "react"
import { createRoot } from "react-dom/client"
import type { CatalogItem, PetState } from "../types"
import { assetPath } from "../types"

interface PresetsPanelOptions {
	container: HTMLElement
	getState(): PetState
	getItem(id: string): CatalogItem | undefined
	command(name: string, argument?: unknown): Promise<{ ok: boolean }>
	navigate(page: "collection"): void
}

export function mountPresetsPanel(options: PresetsPanelOptions) {
	const root = createRoot(options.container)
	return () =>
		root.render(
			<PresetsPanelView
				presets={options.getState().presets}
				getItem={options.getItem}
				command={options.command}
				navigate={options.navigate}
			/>,
		)
}

function PresetsPanelView({
	presets,
	getItem,
	command,
	navigate,
}: Omit<PresetsPanelOptions, "container" | "getState"> & { presets: PetState["presets"] }) {
	const [name, setName] = useState("")

	const savePreset = async () => {
		const result = await command("preset-save", name || "My Outfit")
		if (!result.ok) return
		setName("")
		navigate("collection")
	}

	return (
		<div className="panel-content">
			<div className="save-preset">
				<input
					id="presetName"
					maxLength={24}
					placeholder="Preset Name"
					value={name}
					onChange={event => setName(event.currentTarget.value)}
				/>
				<button className="common-btn" id="savePreset" type="button" onClick={() => void savePreset()}>
					Save Current Outfit
				</button>
			</div>
			<div id="presets" className="presets">
				{presets.length === 0 && <div className="empty">No presets saved</div>}
				{presets.map(preset => {
					const character = getItem(preset.character)
					if (!character) return null
					return (
						<article className="preset" key={preset.id}>
							<img src={assetPath(character.thumbnail)} draggable={false} />
							<h3>{preset.name}</h3>
							<div className="actions">
								<button className="common-btn" type="button" onClick={() => void command("preset-load", preset.id)}>
									Equip
								</button>
								<button
									className="common-btn"
									type="button"
									onClick={() => {
										if (confirm(`Delete preset “${preset.name}”?`)) void command("preset-delete", preset.id)
									}}
								>
									Delete
								</button>
							</div>
						</article>
					)
				})}
			</div>
		</div>
	)
}
