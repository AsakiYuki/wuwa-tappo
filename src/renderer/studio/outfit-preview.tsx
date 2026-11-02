import { createRoot } from "react-dom/client"
import { getItemName } from "../names"
import type { CatalogItem, PetState } from "../types"
import { assetPath } from "../types"

interface OutfitPreviewOptions {
	container: HTMLElement
	getState(): PetState
	getItem(id: string): CatalogItem | undefined
	getReplacementSlot(): number | null
	chooseEmoteSlot(slot: number): void
	command(name: string, argument?: unknown): Promise<unknown>
	navigateToPresets(): void
}

export function mountOutfitPreview(options: OutfitPreviewOptions) {
	const root = createRoot(options.container)
	return () =>
		root.render(
			<OutfitPreviewView
				state={options.getState()}
				getItem={options.getItem}
				replacementSlot={options.getReplacementSlot()}
				chooseEmoteSlot={options.chooseEmoteSlot}
				command={options.command}
				navigateToPresets={options.navigateToPresets}
			/>,
		)
}

function OutfitPreviewView({
	state,
	getItem,
	replacementSlot,
	chooseEmoteSlot,
	command,
	navigateToPresets,
}: Omit<OutfitPreviewOptions, "container" | "getState" | "getReplacementSlot"> & {
	state: PetState
	replacementSlot: number | null
}) {
	const character = getItem(state.character)
	if (!character) return null

	const accessory = state.accessory ? getItem(state.accessory) : undefined
	const renderPresetImage = (characterId: string, accessoryId: string) => {
		const presetCharacter = getItem(characterId)
		if (!presetCharacter) return <div className="preset-img" />
		const presetAccessory = accessoryId ? getItem(accessoryId) : undefined
		return (
			<div className="preset-img">
				<img src={assetPath(presetCharacter.layers.head1)} draggable={false} />
				<img src={assetPath(presetCharacter.layers.body1)} draggable={false} />
				{presetAccessory && (
					<img
						src={assetPath(presetAccessory.image)}
						style={{
							transform: `translate(${(presetCharacter.offsetX || 0) * 0.5}px, ${(presetCharacter.offsetY || 0) * 0.5}px)`,
						}}
						draggable={false}
					/>
				)}
			</div>
		)
	}

	return (
		<>
			<div className="preset-preview">
				<div className="preset-preview-main">
					<div className="preset-preview-img-box">
						<div className="offline-preview">
							<img src={assetPath(character.layers.head1)} />
							<img src={assetPath(character.layers.body1)} />
							<img
								id="heroAccessory"
								hidden={!accessory}
								src={accessory ? assetPath(accessory.image) : undefined}
								style={
									accessory
										? {
												transform: `translate(${(character.offsetX || 0) * 1.2}px, ${(character.offsetY || 0) * 1.2}px)`,
											}
										: undefined
								}
							/>
						</div>
					</div>
					<div id="previewEmotes">
						{Array.from({ length: 5 }, (_, slot) => {
							const id = state.emotes[slot]
							const emote = id ? getItem(id) : undefined
							const isReplacing = replacementSlot === slot
							return (
								<button
									className={`preset-preview-emote preset-preview-emote${slot + 1}${isReplacing ? " replacing-emote" : ""}`}
									key={slot}
									title={emote ? `Replace emote ${slot + 1} · ${getItemName(emote)}` : `Equip emote ${slot + 1}`}
									onClick={() => chooseEmoteSlot(slot)}
									onContextMenu={event => {
										if (!emote || !id) return
										event.preventDefault()
										void command("emote", id)
									}}
								>
									<div className="preset-preview-emote-img">
										{emote && <img src={assetPath(emote.image)} draggable={false} />}
									</div>
									<span className="emote-change-label">{isReplacing ? "Selecting" : "Change"}</span>
								</button>
							)
						})}
					</div>
				</div>
			</div>
			<div className="my-preset">
				<div className="my-preset-title">My Presets</div>
				<div className="my-preset-list" id="miniPresets">
					{Array.from({ length: Math.max(6, state.presets.length + 1) }, (_, index) => {
						const preset = state.presets[index]
						return (
							<button
								className={`preset-item${preset ? "" : " preset-item--add"}`}
								key={preset?.id ?? `add-${index}`}
								title={preset?.name ?? "Add Preset"}
								onClick={() => (preset ? void command("preset-load", preset.id) : navigateToPresets())}
								onContextMenu={event => {
									if (!preset) return
									event.preventDefault()
									navigateToPresets()
								}}
							>
								{preset && renderPresetImage(preset.character, preset.accessory)}
							</button>
						)
					})}
				</div>
			</div>
		</>
	)
}
