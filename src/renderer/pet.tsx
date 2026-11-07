import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { createRoot } from "react-dom/client"
import "../../assets/ui/application/styles.css"
import "../styles/pet.scss"
import type { CatalogItem, InputMessage, PetState } from "./types"
import { assetPath } from "./types"
import { emotionMotion, floatEmotion, floatKeyBubble } from "./emotions"
import { getItemName } from "./names"

const keyboardRows = [
	["Tab|Tab", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "Backspace|⌫"],
	["CapsLock|Caps", "A", "S", "D", "F", "G", "H", "J", "K", "L", "Semicolon|;", "Enter|↵"],
	["Shift|Shift", "Z", "X", "C", "V", "B", "N", "M", "Comma|,", "Period|.", "Slash|/"],
	["Ctrl|Ctrl", "Meta|Meta", "Alt|Alt", "Space|SPACE", "AltRight|Alt", "ShiftRight|Shift", "CtrlRight|Ctrl"],
]

function colorLuminance(color: string) {
	const channels = color
		.slice(1)
		.match(/.{2}/g)
		?.map(value => Number.parseInt(value, 16) / 255)
	if (!channels || channels.length !== 3) return 1
	const [red, green, blue] = channels.map(value =>
		value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
	)
	return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function colorWithLightness(color: string, lightness: number) {
	const channels = color
		.slice(1)
		.match(/.{2}/g)
		?.map(value => Number.parseInt(value, 16) / 255)
	if (!channels || channels.length !== 3) return color
	const [red, green, blue] = channels
	const maximum = Math.max(red, green, blue)
	const minimum = Math.min(red, green, blue)
	const delta = maximum - minimum
	let hue = 0
	if (delta) {
		if (maximum === red) hue = ((green - blue) / delta) % 6
		else if (maximum === green) hue = (blue - red) / delta + 2
		else hue = (red - green) / delta + 4
		hue = (hue * 60 + 360) % 360
	}
	const sourceLightness = (maximum + minimum) / 2
	const saturation = delta ? delta / (1 - Math.abs(2 * sourceLightness - 1)) : 0
	const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
	const section = hue / 60
	const secondary = chroma * (1 - Math.abs((section % 2) - 1))
	const [r, g, b] =
		section < 1
			? [chroma, secondary, 0]
			: section < 2
				? [secondary, chroma, 0]
				: section < 3
					? [0, chroma, secondary]
					: section < 4
						? [0, secondary, chroma]
						: section < 5
							? [secondary, 0, chroma]
							: [chroma, 0, secondary]
	const offset = lightness - chroma / 2
	return `#${[r, g, b]
		.map(value =>
			Math.max(0, Math.min(255, Math.round((value + offset) * 255)))
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`
}

function bubbleTextColor(background: string) {
	const backgroundLuminance = colorLuminance(background)
	const contrast = (foreground: string) => {
		const foregroundLuminance = colorLuminance(foreground)
		return (
			(Math.max(backgroundLuminance, foregroundLuminance) + 0.05) /
			(Math.min(backgroundLuminance, foregroundLuminance) + 0.05)
		)
	}
	let bestColor = background
	let bestContrast = 0
	for (let index = 0; index <= 20; index++) {
		const candidate = colorWithLightness(background, 0.1 + index * 0.04)
		const candidateContrast = contrast(candidate)
		if (candidateContrast > bestContrast) {
			bestColor = candidate
			bestContrast = candidateContrast
		}
	}
	return bestColor
}

const controllerLabels: Record<"xbox" | "ps", Record<string, string>> = {
	xbox: {
		South: "A",
		East: "B",
		West: "X",
		North: "Y",
		L1: "LB",
		R1: "RB",
		L2: "LT",
		R2: "RT",
		LeftTriggerAxisPositive: "LT",
		LeftTriggerAxisNegative: "LT",
		RightTriggerAxisPositive: "RT",
		RightTriggerAxisNegative: "RT",
		L3: "LS",
		R3: "RS",
		Select: "BACK",
		Start: "START",
		Mode: "GUIDE",
	},
	ps: {
		South: "×",
		East: "○",
		West: "□",
		North: "△",
		L1: "L1",
		R1: "R1",
		L2: "L2",
		R2: "R2",
		LeftTriggerAxisPositive: "L2",
		LeftTriggerAxisNegative: "L2",
		RightTriggerAxisPositive: "R2",
		RightTriggerAxisNegative: "R2",
		L3: "L3",
		R3: "R3",
		Select: "SHARE",
		Start: "OPTIONS",
		Mode: "PS",
	},
}

const controllerDirections: Record<string, string> = {
	DPadUp: "Up",
	DPadDown: "Down",
	DPadLeft: "Left",
	DPadRight: "Right",
	DPadXPositive: "Right",
	DPadXNegative: "Left",
	DPadYPositive: "Down",
	DPadYNegative: "Up",
}

const mouseLabels: Record<string, string> = {
	MouseLeft: "LMB",
	MouseRight: "RMB",
	MouseMiddle: "MMB",
	MouseBack: "BACK",
	MouseForward: "FORWARD",
	Touchpad: "TOUCH",
}

interface DragState {
	pointerId: number
	x: number
	y: number
	distance: number
}

function PetApp() {
	const [state, setState] = useState<PetState | null>(null)
	const [items, setItems] = useState<CatalogItem[]>([])
	const [face, setFace] = useState(1)
	const [action, setAction] = useState(1)
	const [activeKeys, setActiveKeys] = useState<Set<string>>(() => new Set())
	const [serial, setSerial] = useState(0)
	const [menuOpen, setMenuOpen] = useState(false)
	const [menuPinned, setMenuPinned] = useState(false)
	const drag = useRef<DragState | null>(null)
	const bodyTimer = useRef<number | undefined>(undefined)
	const menuTimer = useRef<number | undefined>(undefined)
	const pointerDownAt = useRef(0)
	const lastMouseInputAt = useRef(0)
	const heldActionKeys = useRef(new Map<string, 2 | 3>())
	const handAnimation = useRef<PetState["settings"]["handAnimation"]>("adaptive")
	const holdAnimation = useRef(false)
	const showPressedKeys = useRef(true)
	const showMouseBubbles = useRef(true)
	const bubbleLifetime = useRef(1)
	const controllerStyle = useRef<"xbox" | "ps">("xbox")
	const keyLabels = useRef<Record<string, string>>({})
	const alternateHand = useRef<"left" | "right">("left")
	handAnimation.current = state?.settings.handAnimation ?? "adaptive"
	holdAnimation.current = state?.settings.holdAnimation ?? false
	showPressedKeys.current = state?.settings.showPressedKeys ?? true
	showMouseBubbles.current = state?.settings.showMouseBubbles ?? true
	bubbleLifetime.current = state?.settings.bubbleLifetime ?? 1
	controllerStyle.current = state?.settings.controllerStyle ?? "xbox"
	const itemMap = useMemo(() => new Map(items.map(item => [item.id, item])), [items])
	const itemMapRef = useRef(itemMap)
	itemMapRef.current = itemMap
	keyLabels.current = { ...(state?.settings.keyLabels ?? {}) }
	const character = state ? itemMap.get(state.character) : undefined
	const accessory = state ? itemMap.get(state.accessory) : undefined
	const getKeyLabel = useCallback((key: string) => {
		const trimmed = key.trim()
		if (!trimmed) return key
		if (keyLabels.current[trimmed] || mouseLabels[trimmed]) return keyLabels.current[trimmed] ?? mouseLabels[trimmed]
		const separator = trimmed.lastIndexOf(":")
		if (separator >= 0) {
			const button = trimmed.slice(separator + 1)
			return (
				keyLabels.current[button] ??
				controllerLabels[controllerStyle.current][button] ??
				controllerDirections[button] ??
				(/^Button(\d+)$/.exec(button)?.[1] ? `B${/^Button(\d+)$/.exec(button)![1]}` : button)
			)
		}
		return trimmed
	}, [])

	const resolveAction = useCallback((inputSide: "left" | "right") => {
		let side = inputSide
		switch (handAnimation.current) {
			case "alternate":
				side = alternateHand.current
				alternateHand.current = side === "left" ? "right" : "left"
				break
			case "random":
				side = Math.random() < 0.5 ? "left" : "right"
				break
			case "right":
				side = "right"
				break
			case "left":
				side = "left"
				break
		}
		return side === "left" ? 2 : 3
	}, [])

	const playAction = useCallback(
		(inputSide: "left" | "right") => {
			setAction(resolveAction(inputSide))
			window.clearTimeout(bodyTimer.current)
			bodyTimer.current = window.setTimeout(() => setAction(1), 150)
		},
		[resolveAction],
	)

	useEffect(() => {
		if (state?.settings.holdAnimation && state.settings.inputEnabled) return
		heldActionKeys.current.clear()
		window.clearTimeout(bodyTimer.current)
		bodyTimer.current = undefined
		setAction(1)
	}, [state?.settings.holdAnimation, state?.settings.inputEnabled])

	useEffect(() => {
		window.petAPI.onState(setState)
		window.petAPI.onInput((event: InputMessage) => {
			setSerial(event.serial)
			setState(previous => (previous ? { ...previous, count: event.count } : previous))
			setActiveKeys(previous => {
				const next = new Set(previous)
				event.down ? next.add(event.key) : next.delete(event.key)
				return next
			})
			if (event.down) {
				const isTouchpad = event.key === "Touchpad"
				const isMouse = event.key.startsWith("Mouse")
				if (isMouse || isTouchpad) lastMouseInputAt.current = Date.now()
				const layer = document.getElementById("bubble")
				if (layer && (isMouse || isTouchpad ? showMouseBubbles.current : showPressedKeys.current)) {
					floatKeyBubble(layer, getKeyLabel(event.key), bubbleLifetime.current)
				}
				if (holdAnimation.current) {
					const action = resolveAction(event.side)
					heldActionKeys.current.set(event.key, action)
					window.clearTimeout(bodyTimer.current)
					bodyTimer.current = undefined
					setAction(action)
				} else {
					playAction(event.side)
				}
			} else {
				const wasHeld = heldActionKeys.current.delete(event.key)
				if (holdAnimation.current && wasHeld) {
					const remainingActions = [...heldActionKeys.current.values()]
					window.clearTimeout(bodyTimer.current)
					bodyTimer.current = undefined
					setAction(remainingActions.at(-1) ?? 1)
				}
			}
		})
		window.petAPI.onEmote(id => {
			const item = itemMapRef.current.get(id)
			const layer = document.getElementById("bubble")
			if (item && layer) floatEmotion(layer, item, bubbleLifetime.current)
		})
		window.petAPI.onStatus(status => {
			const element = document.getElementById("inputStatus")
			if (element) element.title = status.hook + (status.warning ? ` · ${status.warning}` : "")
		})
		void window.petAPI.init().then(({ state: initialState, items: catalog }) => {
			setState(initialState)
			setItems(catalog)
		})

		const blink = window.setInterval(() => {
			setFace(2)
			window.setTimeout(() => setFace(1), 180)
		}, 4200)
		return () => {
			window.clearInterval(blink)
			window.clearTimeout(bodyTimer.current)
			window.clearTimeout(menuTimer.current)
		}
	}, [playAction])

	useEffect(() => {
		window.__petTest = () => ({
			character: state?.character,
			count: String(state?.count ?? 0),
			serial,
			action,
			face,
			loaded: ["head", "body"].every(id => {
				const image = document.getElementById(id) as HTMLImageElement | null
				return Boolean(image?.complete && image.naturalWidth > 0)
			}),
			bubble: Boolean(document.querySelector("#bubble img")),
			keys: document.querySelectorAll(".key").length,
			tilt: getComputedStyle(document.querySelector(".keyboard-plane")!).transform,
		})
	}, [action, face, serial, state])

	function startDrag(event: React.PointerEvent<HTMLElement>) {
		if (!state || event.button !== 0 || state.settings.lockDrag) return
		if ((event.target as HTMLElement).closest("button, #counter, .key, .emotion-dot, #emoteBar")) return
		pointerDownAt.current = Date.now()
		drag.current = {
			pointerId: event.pointerId,
			x: event.screenX,
			y: event.screenY,
			distance: 0,
		}
		event.currentTarget.setPointerCapture(event.pointerId)
	}

	function moveDrag(event: React.PointerEvent<HTMLElement>) {
		const active = drag.current
		if (!active || event.pointerId !== active.pointerId) return
		const dx = event.screenX - active.x
		const dy = event.screenY - active.y
		active.x = event.screenX
		active.y = event.screenY
		active.distance += Math.abs(dx) + Math.abs(dy)
		if (dx || dy) window.petAPI.move(dx, dy)
	}

	function endDrag(event: React.PointerEvent<HTMLElement>) {
		const active = drag.current
		if (!active || event.pointerId !== active.pointerId) return
		if (active.distance < 4) {
			const handledByInputHook = state.settings.inputEnabled && lastMouseInputAt.current >= pointerDownAt.current - 150
			if (!handledByInputHook) playAction("left")
			void window.petAPI.command("tap")
		}
		drag.current = null
		pointerDownAt.current = 0
	}

	if (!state) return <main id="petRoot" />

	const head = character?.layers?.[`head${face}`] ?? character?.image ?? ""
	const body = character?.layers?.[`body${action}`] ?? character?.image ?? ""
	const name = getItemName(character) || character?.name || ""

	return (
		<main
			id="petRoot"
			className={`${state.settings.hoverFade ? "hover-fade" : ""} ${state.settings.showKeyboard ? "" : "hide-keyboard"} ${state.settings.counterLeft ? "counter-left" : ""}`}
			style={{ transform: `scale(${state.settings.scale})`, opacity: state.settings.opacity }}
			onPointerDown={startDrag}
			onPointerMove={moveDrag}
			onPointerUp={endDrag}
			onPointerCancel={endDrag}
		>
			<div
				id="petContent"
				onPointerEnter={() => {
					window.clearTimeout(menuTimer.current)
					setMenuOpen(true)
				}}
				onPointerLeave={() => {
					menuTimer.current = window.setTimeout(() => {
						if (!menuPinned) setMenuOpen(false)
					}, 160)
				}}
			>
				<div id="stage" title="Drag Pet">
					<img id="head" src={assetPath(head)} draggable={false} />
					<img id="body" src={assetPath(body)} draggable={false} />
					{accessory && (
						<img
							id="accessory"
							src={assetPath(accessory.image)}
							style={{
								transform: `translate(${character?.offsetX ?? 0}px, ${character?.offsetY ?? 0}px)`,
							}}
							draggable={false}
						/>
					)}
					<div
						id="bubble"
						className="local-emotion-bubble-layer"
						style={
							{
								"--bubble-color": state?.settings.bubbleColor ?? "#ffd26f",
								"--bubble-text-color": bubbleTextColor(state?.settings.bubbleColor ?? "#ffd26f"),
							} as CSSProperties
						}
					/>
				</div>
				<div id="petName" hidden>
					{name}
				</div>
				<div
					id="emoteBar"
					className={`emotion-menu${menuOpen ? " emotion-menu--open" : ""}${emotionMotion.reduce ? " emotion-menu--reduce-motion" : ""}`}
				>
					{state.emotes.map((id, index) => {
						const emote = itemMap.get(id)
						if (!emote) return null
						return (
							<div className="emotion-dot-slot" style={{ "--fan-i": index } as CSSProperties} key={id}>
								<button
									className="emotion-dot"
									title={`${getItemName(emote) || emote.name} · Ctrl+Alt+${index + 1}`}
									ref={button => {
										const image = button?.querySelector("img")
										if (button && image) emotionMotion.bind(button, image)
									}}
									onClick={event => {
										event.stopPropagation()
										void window.petAPI.command("emote", id)
									}}
								>
									<img className="emotion-img" src={assetPath(emote.image)} draggable={false} />
								</button>
							</div>
						)
					})}
				</div>
				<section className="desk">
					<div className="keyboard-plane">
						<div className="keyboard" id="keyboard" aria-label="42-key keyboard">
							{keyboardRows.map((row, rowIndex) => (
								<div className="keyrow" key={rowIndex}>
									{row.map(entry => {
										const [key, label] = entry.split("|")
										const wide = ["Shift", "ShiftRight", "Enter", "Backspace", "CapsLock", "Tab"].includes(key)
										return (
											<span
												className={`key${key === "Space" ? " space" : wide ? " wide" : ""}${state.settings.showPressedKeys && activeKeys.has(key) ? " active" : ""}`}
												data-key={key}
												key={key}
											>
												<span>{label ?? key}</span>
											</span>
										)
									})}
								</div>
							))}
						</div>
					</div>
					<div className="pet-info">
						<div
							className="text"
							id="counter"
							title="Toggle Emote Menu"
							onClick={() => {
								setMenuPinned(pinned => {
									setMenuOpen(!pinned)
									return !pinned
								})
							}}
						>
							{state.count.toLocaleString()}
						</div>
					</div>
					<div className="pet-toolbar">
						{state.settings.showChest && (
							<button
								id="openChest"
								title="Unlimited Chests"
								onClick={() => void window.petAPI.command("open", "draw")}
							/>
						)}
						<button
							className="settings-btn"
							id="openStudio"
							title="Open Studio"
							onClick={() => void window.petAPI.command("open")}
						/>
					</div>
				</section>
				<span id="inputStatus" hidden>
					{state.settings.inputEnabled ? "● Live Mapping" : "○ Input Paused"}
				</span>
			</div>
		</main>
	)
}

createRoot(document.getElementById("root")!).render(<PetApp />)
