import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { createRoot } from "react-dom/client"
import type { CatalogItem, PetAPI, PetState } from "../types"
import { assetPath } from "../types"
import { getSynthesisGroups, type SynthesisGroup, type SynthesisMode } from "./collection"
import { labels, typeNames } from "./constants"

interface SynthesisPanelOptions {
	container: HTMLElement
	materialDialog: HTMLDialogElement
	api: PetAPI
	getItems(): CatalogItem[]
	getState(): PetState
	showResults(results: Array<{ id: string; fresh: boolean }>): void
	toast(message: string): void
}

export function mountSynthesisPanel(options: SynthesisPanelOptions): () => void {
	const root = createRoot(options.container)
	return () => root.render(<SynthesisPanel {...options} items={options.getItems()} state={options.getState()} />)
}

function SynthesisPanel({
	materialDialog,
	api,
	items,
	state,
	showResults,
	toast,
}: Omit<SynthesisPanelOptions, "container" | "getItems" | "getState"> & { items: CatalogItem[]; state: PetState }) {
	const [mode, setMode] = useState<SynthesisMode>("upgrade")
	const [selectedKey, setSelectedKey] = useState<string | null>(null)
	const [materialsOpen, setMaterialsOpen] = useState(false)
	const [working, setWorking] = useState(false)
	const workingRef = useRef(false)
	const groups = useMemo(() => getSynthesisGroups(items, state, mode), [items, state, mode])
	const selectedGroup = groups.find(group => `${group.type}:${group.rarity}` === selectedKey) ?? null
	const cost = mode === "same" ? 5 : 10

	useEffect(() => {
		if (materialsOpen && !materialDialog.open) materialDialog.showModal()
		if (!materialsOpen && materialDialog.open) materialDialog.close()
	}, [materialDialog, materialsOpen])

	const selectedItems: CatalogItem[] = []
	if (selectedGroup) {
		for (const item of selectedGroup.candidates) {
			const duplicates = Math.max(0, (state.owned[item.id] ?? 0) - 1)
			const count = Math.min(cost - selectedItems.length, duplicates)
			for (let index = 0; index < count; index++) selectedItems.push(item)
		}
	}

	const synthesize = async (count: number) => {
		if (workingRef.current || !selectedGroup) return
		workingRef.current = true
		setWorking(true)
		try {
			const result = await api.command("synthesize", {
				n: count,
				rarity: selectedGroup.rarity,
				type: selectedGroup.type,
				mode,
			})
			if (result.ok) showResults(result.result as Array<{ id: string; fresh: boolean }>)
			else if (result.error) toast(result.error)
		} finally {
			workingRef.current = false
			setWorking(false)
		}
	}

	return (
		<>
			<div className="panel-content">
				<div className="atlas-tab">
					<button
						className={`atlas-tab-item${mode === "upgrade" ? " selected" : ""}`}
						data-synth-mode="upgrade"
						onClick={() => {
							setMode("upgrade")
							setSelectedKey(null)
						}}
					>
						Upgrade Synthesis
					</button>
					<button
						className={`atlas-tab-item${mode === "same" ? " selected" : ""}`}
						data-synth-mode="same"
						onClick={() => {
							setMode("same")
							setSelectedKey(null)
						}}
					>
						Same-tier Synthesis
					</button>
				</div>
				<div className="synthesis-main">
					<div className="synthesis-success" id="synthesisCircle" />
					<div className="synthesis-list" id="synthesisSlots">
						{Array.from({ length: cost }, (_, index) => {
							const item = selectedItems[index]
							return (
								<button className="synthesis-item" key={index} onClick={() => setMaterialsOpen(true)}>
									{item && selectedGroup ? (
										<div className={`synthesis-thumb synthesis-thumb--${selectedGroup.rarity}`}>
											<img src={assetPath(item.thumbnail)} draggable={false} />
										</div>
									) : (
										<div className="synthesis-add" />
									)}
								</button>
							)
						})}
					</div>
					<div className="synthesis-tip">
						Combine {cost} items of the same type and rarity to synthesize 1 random{" "}
						{mode === "same" ? "same-tier" : "higher-tier"} item.
					</div>
					<div className="synthesis-btns">
						<button
							className="common-btn"
							id="autoSelect"
							onClick={() => {
								const group = groups.find(candidate => candidate.count >= cost)
								setSelectedKey(group ? `${group.type}:${group.rarity}` : null)
								if (!group) toast("Not enough duplicate items for synthesis")
							}}
						>
							Auto Select
						</button>
						{[1, 10].map(count => (
							<button
								className="common-btn"
								data-synth-count={count}
								key={count}
								disabled={working || !selectedGroup || selectedGroup.count < cost * count}
								onClick={() => void synthesize(count)}
							>
								Synthesize {count}
							</button>
						))}
					</div>
					<p id="synthesisSelected" className="synthesis-selected">
						{selectedGroup &&
							`${typeNames[selectedGroup.type]} · ${labels[selectedGroup.rarity]} · Duplicates: ${selectedGroup.count}`}
					</p>
				</div>
			</div>
			{createPortal(
				<>
					<button id="closeMaterials" className="popup-close" onClick={() => setMaterialsOpen(false)} />
					<h2>Select Synthesis Materials</h2>
					<div id="materialGroups">
						{groups.map((group: SynthesisGroup) => (
							<button
								className="material-group"
								key={`${group.type}:${group.rarity}`}
								disabled={group.count < cost}
								onClick={() => {
									setSelectedKey(`${group.type}:${group.rarity}`)
									setMaterialsOpen(false)
								}}
							>
								<strong>
									{typeNames[group.type]} · {labels[group.rarity]}
								</strong>
								<p>{group.count} duplicates</p>
							</button>
						))}
					</div>
					<p>Only duplicate copies will be consumed. The last copy is always kept.</p>
				</>,
				materialDialog,
			)}
		</>
	)
}
