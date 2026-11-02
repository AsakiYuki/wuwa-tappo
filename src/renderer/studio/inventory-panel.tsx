import { createRef, forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { createRoot } from "react-dom/client"
import { getItemName } from "../names"
import type { CatalogItem, PetState } from "../types"
import { assetPath } from "../types"
import {
	filterCollection,
	sortCollection,
	type InventoryFilters,
	type InventoryPage,
	type InventoryType,
} from "./collection"
import { labels, ROLE_NAMES, SERIES_NAMES } from "./constants"

type FilterMetadata = { series: Record<string, string>; roles: Record<string, string> }

interface InventoryPanelOptions {
	root: HTMLElement
	typeTabs: HTMLElement
	filterBar: HTMLElement
	inventory: HTMLDivElement
	getItems(): CatalogItem[]
	getState(): PetState
	getPage(): InventoryPage
	getType(): InventoryType
	setType(type: InventoryType): void
	getFilters(): InventoryFilters
	setFilters(filters: InventoryFilters): void
	getFilterMetadata(): FilterMetadata
	isEquipped(item: CatalogItem): boolean
	onSelect(item: CatalogItem): void
	onFavorite(item: CatalogItem): void
	onContextMenu(item: CatalogItem, event: React.MouseEvent): void
}

interface InventoryPanelHandle {
	closeFilters(): void
	getItemCount(): number
}

const typeTabs: Array<{ value: InventoryType; label: string }> = [
	{ value: "all", label: "Recent" },
	{ value: "character", label: "Characters" },
	{ value: "accessory", label: "Accessories" },
	{ value: "emote", label: "Emotes" },
]

const emptyFilters = (): InventoryFilters => ({ series: "all", role: "all", rarity: "all" })

export function mountInventoryPanel(options: InventoryPanelOptions) {
	const root = createRoot(options.root)
	const panelRef = createRef<InventoryPanelHandle>()
	const render = () =>
		root.render(
			<InventoryPanel
				ref={panelRef}
				{...options}
				items={options.getItems()}
				state={options.getState()}
				page={options.getPage()}
				type={options.getType()}
				filters={options.getFilters()}
				metadata={options.getFilterMetadata()}
			/>,
		)
	return {
		render,
		closeFilters: () => panelRef.current?.closeFilters(),
		getItemCount: () => panelRef.current?.getItemCount() ?? 0,
	}
}

interface InventoryPanelProps extends Omit<
	InventoryPanelOptions,
	"root" | "getItems" | "getState" | "getPage" | "getType" | "getFilters" | "getFilterMetadata"
> {
	items: CatalogItem[]
	state: PetState
	page: InventoryPage
	type: InventoryType
	filters: InventoryFilters
	metadata: FilterMetadata
}

const InventoryPanel = forwardRef<InventoryPanelHandle, InventoryPanelProps>(function InventoryPanel(props, ref) {
	const [viewType, setViewType] = useState(props.type)
	const [viewFilters, setViewFilters] = useState(props.filters)
	const itemCount = useRef(0)
	const closeFilters = () => {
		document.querySelectorAll<HTMLElement>(".select-option:popover-open").forEach(popup => popup.hidePopover())
		document.querySelectorAll<HTMLElement>(".select-item--open").forEach(box => {
			box.classList.remove("select-item--open")
			box.querySelector(".select-input")?.setAttribute("aria-expanded", "false")
		})
	}
	useImperativeHandle(ref, () => ({ closeFilters, getItemCount: () => itemCount.current }), [closeFilters])

	useEffect(() => {
		const onDocumentClick = (event: MouseEvent) => {
			if (!(event.target instanceof HTMLElement) || !event.target.closest(".select-item")) closeFilters()
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") closeFilters()
		}
		document.addEventListener("click", onDocumentClick)
		document.addEventListener("keydown", onKeyDown)
		return () => {
			document.removeEventListener("click", onDocumentClick)
			document.removeEventListener("keydown", onKeyDown)
		}
	}, [])
	useEffect(() => setViewType(props.type), [props.type])
	useEffect(() => setViewFilters(props.filters), [props.filters])

	const filteredItems = sortCollection(
		filterCollection(props.items, props.state, props.page, viewType, viewFilters),
		props.state,
		props.page,
		viewType,
	)
	itemCount.current = filteredItems.length

	const updateType = (type: InventoryType) => {
		props.setType(type)
		const filters = emptyFilters()
		props.setFilters(filters)
		setViewType(type)
		setViewFilters(filters)
		props.inventory.scrollTop = 0
	}
	const updateFilter = (key: keyof InventoryFilters, value: string) => {
		const filters = { ...viewFilters, [key]: value }
		props.setFilters(filters)
		setViewFilters(filters)
		props.inventory.scrollTop = 0
		closeFilters()
	}

	const groups =
		props.page === "atlas" && viewType === "all"
			? (["epic", "rare", "uncommon", "common"] as const)
					.map(rarity => ({
						rarity,
						items: filteredItems.filter(item => item.rarity === rarity),
					}))
					.filter(group => group.items.length > 0)
			: []

	return (
		<>
			{createPortal(
				<div className="atlas-tab">
					{typeTabs.map(tab => (
						<button
							className={`atlas-tab-item${viewType === tab.value ? " selected" : ""}`}
							data-type={tab.value}
							id={tab.value === "all" ? "allTab" : undefined}
							key={tab.value}
							onClick={() => updateType(tab.value)}
						>
							{tab.value === "all" && props.page === "atlas" ? "All" : tab.label}
						</button>
					))}
				</div>,
				props.typeTabs,
			)}
			{createPortal(
				<FilterBar {...props} type={viewType} filters={viewFilters} updateFilter={updateFilter} />,
				props.filterBar,
			)}
			{createPortal(
				<div className="inventory-react-content">
					{filteredItems.length === 0 && <div className="empty">No items collected yet</div>}
					{groups.length > 0 ? (
						groups.map(group => (
							<InventoryGroup
								key={group.rarity}
								rarity={group.rarity}
								items={group.items}
								collected={group.items.filter(item => props.state.owned[item.id]).length}
								inventory={props.inventory}
								panel={props}
							/>
						))
					) : (
						<VirtualGrid items={filteredItems} inventory={props.inventory} panel={props} />
					)}
				</div>,
				props.inventory,
			)}
		</>
	)
})

function FilterBar({
	type,
	filters,
	metadata,
	updateFilter,
}: Omit<
	InventoryPanelProps,
	| "root"
	| "typeTabs"
	| "filterBar"
	| "inventory"
	| "getItems"
	| "getState"
	| "getPage"
	| "getType"
	| "setType"
	| "getFilters"
	| "setFilters"
	| "getFilterMetadata"
	| "isEquipped"
	| "onSelect"
	| "onFavorite"
	| "onContextMenu"
> & {
	type: InventoryType
	filters: InventoryFilters
	metadata: FilterMetadata
	updateFilter(key: keyof InventoryFilters, value: string): void
}) {
	if (type === "all") return null
	const specifications: Array<[keyof InventoryFilters, string, Record<string, string>]> = []
	if (type === "character") specifications.push(["series", "Series", metadata.series])
	if (type === "character" || type === "emote") {
		specifications.push(["role", "Role", type === "emote" ? { 0: "Abby", ...metadata.roles } : metadata.roles])
	}
	specifications.push(["rarity", "Rarity", labels])

	return (
		<>
			{specifications.map(([key, title, values]) => (
				<FilterSelect
					key={key}
					filterKey={key}
					title={title}
					values={values}
					selected={filters[key]}
					onSelect={value => updateFilter(key, value)}
				/>
			))}
		</>
	)
}

function FilterSelect({
	filterKey,
	title,
	values,
	selected,
	onSelect,
}: {
	filterKey: keyof InventoryFilters
	title: string
	values: Record<string, string>
	selected: string
	onSelect(value: string): void
}) {
	const boxRef = useRef<HTMLDivElement>(null)
	const popupRef = useRef<HTMLDivElement>(null)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const [open, setOpen] = useState(false)
	const currentTitle =
		selected === "all"
			? title
			: filterKey === "series" && SERIES_NAMES[selected]
				? SERIES_NAMES[selected]
				: filterKey === "role" && ROLE_NAMES[selected]
					? ROLE_NAMES[selected]
					: values[selected]

	const toggle = (event: React.MouseEvent<HTMLButtonElement>) => {
		event.stopPropagation()
		if (open) {
			popupRef.current?.hidePopover()
			setOpen(false)
			return
		}
		document.querySelectorAll<HTMLElement>(".select-option:popover-open").forEach(popup => popup.hidePopover())
		const popup = popupRef.current
		const box = boxRef.current
		if (!popup || !box) return
		const scale = Math.min(innerWidth / 1100, innerHeight / 756)
		const anchor = event.currentTarget.getBoundingClientRect()
		const width = Math.min(filterKey === "role" ? 560 : 240, (innerWidth - 24) / scale)
		popup.style.width = `${width}px`
		popup.style.minWidth = "0"
		popup.style.transform = `scale(${scale})`
		popup.style.transformOrigin = "top left"
		popup.style.left = `${Math.max(12, Math.min(anchor.left, innerWidth - width * scale - 12))}px`
		const below = innerHeight - anchor.bottom - 18
		const above = anchor.top - 18
		const showAbove = below < 160 * scale && above > below
		const availableHeight = Math.max(70, (showAbove ? above : below) / scale)
		const list = popup.querySelector<HTMLElement>(".select-option-list")
		if (list) list.style.maxHeight = `${Math.min(240, availableHeight - 16)}px`
		popup.style.top = "0px"
		popup.showPopover()
		const height = popup.getBoundingClientRect().height
		const top = showAbove ? anchor.top - height - 12 : anchor.bottom + 12
		popup.style.top = `${Math.max(8, Math.min(top, innerHeight - height - 8))}px`
		popup.style.setProperty(
			"--role-popup-arrow-left",
			`${Math.max(20, (anchor.left - parseFloat(popup.style.left)) / scale + 35)}px`,
		)
		popup.classList.toggle("popup-above", showAbove)
		box.classList.add("select-item--open")
		triggerRef.current?.setAttribute("aria-expanded", "true")
		setOpen(true)
	}

	return (
		<div
			className={`select-item${filterKey === "role" ? " select-item--role" : ""}`}
			data-filter={filterKey}
			ref={boxRef}
		>
			<button className="select-input" ref={triggerRef} aria-haspopup="listbox" aria-expanded={open} onClick={toggle}>
				<span className="select-input-text">{currentTitle}</span>
			</button>
			<div
				className="select-option"
				popover="manual"
				ref={popupRef}
				onToggle={event => setOpen(event.currentTarget.matches(":popover-open"))}
			>
				<div className="select-option-list" role="listbox">
					{[["all", "All"], ...Object.entries(values)].map(([value, label]) => {
						const optionTitle =
							value === "all"
								? "All"
								: filterKey === "series" && SERIES_NAMES[value]
									? SERIES_NAMES[value]
									: filterKey === "role" && ROLE_NAMES[value]
										? ROLE_NAMES[value]
										: label
						return (
							<button
								className={`select-option-item${selected === value ? " select-option-item--active" : ""}`}
								data-value={value}
								key={value}
								role="option"
								aria-selected={selected === value}
								onClick={() => onSelect(value)}
							>
								<span className="select-option-item-text">{optionTitle}</span>
							</button>
						)
					})}
				</div>
			</div>
		</div>
	)
}

function InventoryGroup({
	rarity,
	items,
	collected,
	inventory,
	panel,
}: {
	rarity: CatalogItem["rarity"]
	items: CatalogItem[]
	collected: number
	inventory: HTMLDivElement
	panel: InventoryPanelProps
}) {
	const [collapsed, setCollapsed] = useState(false)
	return (
		<section className={`atlas-group${collapsed ? " atlas-list-hidden" : ""}`}>
			<button className="atlas-type" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>
				{labels[rarity]} ({collected}/{items.length})
			</button>
			<div className="atlas-list-wrapper">
				<VirtualGrid items={items} inventory={inventory} panel={panel} collapsed={collapsed} />
			</div>
		</section>
	)
}

function VirtualGrid({
	items,
	inventory,
	panel,
	collapsed = false,
}: {
	items: CatalogItem[]
	inventory: HTMLDivElement
	panel: InventoryPanelProps
	collapsed?: boolean
}) {
	const gridRef = useRef<HTMLDivElement>(null)
	const [viewportVersion, setViewportVersion] = useState(0)
	const columns = Math.max(1, Math.floor(((gridRef.current?.clientWidth ?? inventory.clientWidth) - 48 + 20) / 140))
	const rows = Math.ceil(items.length / columns)
	const scale = Math.min(innerWidth / 1100, innerHeight / 756)
	let firstRow = 0
	let lastRow = 1
	if (gridRef.current && !collapsed) {
		const viewport = inventory.getBoundingClientRect()
		const grid = gridRef.current.getBoundingClientRect()
		firstRow = Math.max(0, Math.floor((viewport.top - grid.top) / scale / 159) - 1)
		lastRow = Math.ceil((viewport.bottom - grid.top) / scale / 159) + 1
	}
	const firstIndex = firstRow * columns
	const lastIndex = Math.min(items.length, lastRow * columns)
	const visibleItems = new Set(items.slice(firstIndex, lastIndex).map(item => item.id))
	const focusedCard =
		document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>("[data-id]") : null
	if (focusedCard) visibleItems.add(focusedCard.dataset.id ?? "")

	useEffect(() => {
		const updateViewport = () => setViewportVersion(version => version + 1)
		inventory.addEventListener("scroll", updateViewport, { passive: true })
		window.addEventListener("resize", updateViewport)
		const observer = new ResizeObserver(updateViewport)
		if (gridRef.current) observer.observe(gridRef.current)
		updateViewport()
		return () => {
			inventory.removeEventListener("scroll", updateViewport)
			window.removeEventListener("resize", updateViewport)
			observer.disconnect()
		}
	}, [inventory])
	void viewportVersion

	return (
		<div
			className="atlas-list virtual-grid"
			ref={gridRef}
			style={{ position: "relative", height: `${rows ? rows * 159 + 4 : 0}px` }}
		>
			{items.map((item, index) => {
				if (!visibleItems.has(item.id)) return null
				return (
					<InventoryCard
						key={item.id}
						item={item}
						state={panel.state}
						page={panel.page}
						isEquipped={panel.isEquipped(item)}
						onSelect={() => panel.onSelect(item)}
						onFavorite={() => panel.onFavorite(item)}
						onContextMenu={event => panel.onContextMenu(item, event)}
						style={{ left: `${24 + (index % columns) * 140}px`, top: `${12 + Math.floor(index / columns) * 159}px` }}
					/>
				)
			})}
		</div>
	)
}

function InventoryCard({
	item,
	state,
	page,
	isEquipped,
	onSelect,
	onFavorite,
	onContextMenu,
	style,
}: {
	item: CatalogItem
	state: PetState
	page: InventoryPage
	isEquipped: boolean
	onSelect(): void
	onFavorite(): void
	onContextMenu(event: React.MouseEvent<HTMLElement>): void
	style: React.CSSProperties
}) {
	const owned = state.owned[item.id] || 0
	const kind = item.type === "character" ? "character_skin" : item.type
	const name = getItemName(item)
	return (
		<article
			className={`atlas-item item-card atlas-item--${kind}${!owned ? " atlas-item--unowned" : ""}${isEquipped && page !== "atlas" ? " atlas-item--active" : ""}`}
			data-id={item.id}
			title={`${name} · ${labels[item.rarity]}`}
			style={{ position: "absolute", ...style }}
			tabIndex={0}
			onClick={onSelect}
			onKeyDown={event => {
				if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
					event.preventDefault()
					event.currentTarget.click()
				}
			}}
			onContextMenu={onContextMenu}
		>
			<div className={`atlas-thumb atlas-thumb--${item.rarity}`}>
				<img src={assetPath(item.thumbnail)} loading="eager" draggable={false} />
			</div>
			<div className="atlas-name">
				<div className="atlas-name-inner">{name}</div>
			</div>
			<span className="atlas-type-icon" />
			{owned > 1 && <span className="atlas-qty">{owned}</span>}
			<button
				className={`atlas-collect${state.favorites.includes(item.id) ? " atlas-collect--active" : ""}`}
				title="Favorite / Unfavorite"
				aria-label={`Favorite ${name}`}
				onClick={event => {
					event.stopPropagation()
					onFavorite()
				}}
			/>
		</article>
	)
}
