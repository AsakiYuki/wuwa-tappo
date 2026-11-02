import { createRef, forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { createRoot } from "react-dom/client"
import { getItemName } from "../names"
import type { CatalogItem } from "../types"
import { assetPath } from "../types"
import { labels } from "./constants"

interface ResultEntry {
	id: string
	fresh: boolean
}

interface ResultsPanelOptions {
	container: HTMLElement
	drawButtonsContainer: HTMLElement
	dialog: HTMLDialogElement
	getItem(id: string): CatalogItem | undefined
	command(name: string, argument?: unknown): Promise<{ ok: boolean; result?: unknown }>
	toast(message: string): void
}

interface ResultsPanelHandle {
	showResults(results: ResultEntry[], source: "draw" | "synthesis"): void
	showSynthesisResults(results: ResultEntry[]): void
}

export function mountResultsPanel(options: ResultsPanelOptions) {
	const root = createRoot(options.container)
	const panelRef = createRef<ResultsPanelHandle>()
	root.render(<ResultsPanel ref={panelRef} {...options} />)
	return {
		showResults: (results: ResultEntry[], source: "draw" | "synthesis") =>
			panelRef.current?.showResults(results, source),
		showSynthesisResults: (results: ResultEntry[]) => panelRef.current?.showSynthesisResults(results),
	}
}

const ResultsPanel = forwardRef<ResultsPanelHandle, ResultsPanelOptions>(function ResultsPanel(
	{ dialog, drawButtonsContainer, getItem, command, toast },
	ref,
) {
	const [payload, setPayload] = useState<{ results: ResultEntry[]; source: "draw" | "synthesis" } | null>(null)
	const [lastDraw, setLastDraw] = useState(10)
	const [drawing, setDrawing] = useState(false)
	const drawingRef = useRef(false)

	const showResults = (results: ResultEntry[], source: "draw" | "synthesis") => setPayload({ results, source })
	useImperativeHandle(ref, () => ({
		showResults,
		showSynthesisResults: results => showResults(results, "synthesis"),
	}))

	useEffect(() => {
		if (payload && !dialog.open) dialog.showModal()
		if (!payload && dialog.open) dialog.close()
	}, [dialog, payload])

	const draw = async (count: number) => {
		if (drawingRef.current) return
		drawingRef.current = true
		setDrawing(true)
		setLastDraw(count)
		try {
			const response = await command("draw", count)
			if (response.ok) showResults(response.result as ResultEntry[], "draw")
		} finally {
			drawingRef.current = false
			setDrawing(false)
		}
	}

	return createPortal(
		<>
			{createPortal(
				<div className="draw-buttons">
					<button className="common-btn" data-draw="1" onClick={() => void draw(1)}>
						Draw 1 ∞
					</button>
					<button className="common-btn" data-draw="10" onClick={() => void draw(10)}>
						Draw 10 ∞
					</button>
				</div>,
				drawButtonsContainer,
			)}
			<button id="closeResults" className="popup-close" title="Close" onClick={() => setPayload(null)} />
			{payload && (
				<>
					<h2 id="resultTitle">{payload.source === "draw" ? "Items Obtained" : "Synthesis Successful"}</h2>
					<div className={`result-grid${payload.results.length === 1 ? " single" : ""}`} id="resultGrid">
						{payload.results.map((result, index) => {
							const item = getItem(result.id)
							if (!item) return null
							const kind = item.type === "character" ? "character_skin" : item.type
							return (
								<article
									className="result-card"
									key={`${result.id}-${index}`}
									style={{ animationDelay: `${index * 0.04}s` }}
								>
									<article className={`atlas-item item-card atlas-item--${kind}`}>
										<div className={`atlas-thumb atlas-thumb--${item.rarity}`}>
											<img src={assetPath(item.thumbnail)} draggable={false} />
										</div>
										<div className="atlas-name">
											<div className="atlas-name-inner">{getItemName(item)}</div>
										</div>
										<span className="atlas-type-icon" />
									</article>
									<p className="result-quality">{labels[item.rarity]}</p>
									{result.fresh && <span className="new">NEW</span>}
									{item.type !== "emote" && (
										<button
											className="common-btn"
											onClick={async () => {
												if ((await command("equip", item.id)).ok) toast(`Equipped ${getItemName(item)}`)
											}}
										>
											Equip
										</button>
									)}
								</article>
							)
						})}
					</div>
					<div className="result-footer">
						<p>Saved to inventory</p>
						{payload.source === "draw" && (
							<button id="drawAgain" className="common-btn" disabled={drawing} onClick={() => void draw(lastDraw)}>
								{lastDraw === 10 ? "Draw 10 Again ∞" : "Draw 1 Again ∞"}
							</button>
						)}
					</div>
				</>
			)}
		</>,
		dialog,
	)
})
