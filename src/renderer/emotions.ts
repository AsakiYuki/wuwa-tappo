import type { CatalogItem } from "./types"

interface MotionState {
	button: HTMLButtonElement
	img: HTMLImageElement
	x: number
	y: number
	r: number
	vx: number
	vy: number
	vr: number
	targetX: number
	targetY: number
	targetR: number
	held: boolean
	active: boolean
	pressedAt: number
	releaseTimer?: number
	returnTimer?: number
}

/* Original EmotionMenu spring constants and bubble trajectory, using local assets. */
const emotionMotion = (() => {
	const states = new Map<HTMLButtonElement, MotionState>(),
		reduce = matchMedia("(prefers-reduced-motion: reduce)").matches
	const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
	function spring(x: number, v: number, target: number, k: number, d: number, dt: number): [number, number] {
		v += ((target - x) * k - v * d) * dt
		return [x + v * dt, v]
	}
	function release(s: MotionState) {
		if (!s.held) return
		s.held = false
		s.releaseTimer = window.setTimeout(
			() => {
				s.targetX = 1.48
				s.targetY = 1.2
				s.targetR = 0.035
				s.vx += 2.4
				s.vy += 3.3
				s.vr += 0.32
				wake(s)
				s.returnTimer = window.setTimeout(() => {
					s.targetX = 1
					s.targetY = 1
					s.targetR = 0
					wake(s)
				}, 115)
			},
			Math.max(0, 80 - (performance.now() - s.pressedAt)),
		)
	}
	let frame = 0,
		previous = performance.now(),
		ticks = 0
	function wake(s: MotionState) {
		s.active = true
		if (!frame) {
			previous = performance.now()
			frame = requestAnimationFrame(tick)
		}
	}
	function bind(button: HTMLButtonElement, img: HTMLImageElement) {
		for (const [b, old] of states)
			if (!b.isConnected) {
				clearTimeout(old.releaseTimer)
				clearTimeout(old.returnTimer)
				states.delete(b)
			}
		const s: MotionState = {
			button,
			img,
			x: 1,
			y: 1,
			r: 0,
			vx: 0,
			vy: 0,
			vr: 0,
			targetX: 1,
			targetY: 1,
			targetR: 0,
			held: false,
			active: false,
			pressedAt: 0,
		}
		states.set(button, s)
		function press() {
			if (reduce || s.held) return
			clearTimeout(s.releaseTimer)
			clearTimeout(s.returnTimer)
			s.held = true
			s.pressedAt = performance.now()
			s.targetX = 0.86
			s.targetY = 0.72
			s.targetR = -0.025
			s.vy -= 0.8
			wake(s)
		}
		button.onpointerdown = (e: PointerEvent) => {
			e.stopPropagation()
			button.setPointerCapture(e.pointerId)
			press()
		}
		button.onpointerup = button.onpointercancel = button.onpointerleave = () => release(s)
		button.onkeydown = (e: KeyboardEvent) => {
			if (e.key === " " || e.key === "Enter") {
				e.preventDefault()
				press()
			}
		}
		button.onkeyup = (e: KeyboardEvent) => {
			if (e.key === " " || e.key === "Enter") {
				e.preventDefault()
				release(s)
				button.click()
			}
		}
	}
	function tick(now: number) {
		frame = 0
		ticks++
		const dt = Math.min((now - previous) / 1000, 0.028)
		previous = now
		for (const [button, s] of states) {
			if (!button.isConnected) {
				clearTimeout(s.releaseTimer)
				clearTimeout(s.returnTimer)
				states.delete(button)
				continue
			}
			if (!s.active) continue
			;[s.x, s.vx] = spring(s.x, s.vx, s.targetX, 245, 13.2, dt)
			;[s.y, s.vy] = spring(s.y, s.vy, s.targetY, 285, 14, dt)
			;[s.r, s.vr] = spring(s.r, s.vr, s.targetR, 205, 12.5, dt)
			const x = clamp(s.x, 0.72, 1.72),
				y = clamp(s.y, 0.62, 1.55),
				q = clamp((s.vx - s.vy) * 0.022, -0.13, 0.13),
				b = clamp(((x + y) * 0.5 - 1) / 0.42, -0.35, 1.25)
			const radii = [
				50 + b * 7 + q * 50,
				50 - b * 5 - q * 42,
				50 + b * 4 - q * 35,
				50 - b * 3 + q * 45,
				50 - q * 38,
				50 + q * 34,
				50 - b * 3 + q * 40,
				50 + b * 4 - q * 36,
			].map(v => `${clamp(v, 38, 64)}%`)
			button.style.transform =
				"scale(" +
				x.toFixed(4) +
				"," +
				y.toFixed(4) +
				") rotate(" +
				clamp(s.r + (s.vx - s.vy) * 0.0025, -0.075, 0.075).toFixed(4) +
				"rad)"
			button.style.borderRadius = radii.slice(0, 4).join(" ") + " / " + radii.slice(4).join(" ")
			s.img.style.transform =
				"translateY(" +
				((1 - y) * 3.5 - s.vy * 0.21).toFixed(2) +
				"px) scale(" +
				(1 - (x - 1) * 0.16).toFixed(3) +
				"," +
				(1 - (y - 1) * 0.13).toFixed(3) +
				")"
			if (
				Math.abs(s.x - s.targetX) +
					Math.abs(s.y - s.targetY) +
					Math.abs(s.r - s.targetR) +
					Math.abs(s.vx) +
					Math.abs(s.vy) +
					Math.abs(s.vr) <
				0.001
			) {
				s.active = false
				if (!s.held) {
					button.style.transform = ""
					button.style.borderRadius = ""
					s.img.style.transform = ""
				}
			}
		}
		if ([...states.values()].some(s => s.active)) frame = requestAnimationFrame(tick)
	}
	return {
		bind,
		reduce,
		get ticks() {
			return ticks
		},
		get animating() {
			return !!frame
		},
	}
})()
const bubbleOffsets = [
	[-30, 10],
	[4, -6],
	[28, 12],
	[-14, 2],
	[36, 6],
	[-38, 16],
	[16, -10],
	[-6, 8],
]
let bubbleIndex = 0
function floatEmotion(layer: HTMLElement, item: CatalogItem, lifetime = 1) {
	const [x, y] = bubbleOffsets[bubbleIndex++ % bubbleOffsets.length],
		bubble = document.createElement("div"),
		img = document.createElement("img")
	bubble.className = "local-emotion-bubble"
	bubble.dataset.emote = item.id
	bubble.style.animationDuration = `${lifetime}s`
	bubble.style.setProperty("--bubble-ox", Math.round(x + Math.random() * 10 - 5) + "px")
	bubble.style.setProperty("--bubble-oy", Math.round(y + Math.random() * 8 - 4 - 50) + "px")
	img.src = item.image.startsWith("assets/") ? "../" + item.image : item.image
	img.alt = item.name
	img.className = "local-emotion-bubble__img"
	bubble.append(img)
	layer.append(bubble)
	bubble.addEventListener("animationend", () => bubble.remove(), {
		once: true,
	})
	window.setTimeout(() => bubble.remove(), lifetime * 1000 + 200)
}
function floatKeyBubble(layer: HTMLElement, label: string, lifetime = 1) {
	if (!label) return
	const [x, y] = bubbleOffsets[bubbleIndex++ % bubbleOffsets.length],
		bubble = document.createElement("div")
	bubble.className = "local-key-bubble"
	bubble.dataset.key = label
	bubble.style.animationDuration = `${lifetime}s`
	bubble.style.setProperty("--bubble-ox", Math.round(x + Math.random() * 8 - 4) + "px")
	bubble.style.setProperty("--bubble-oy", Math.round(y + Math.random() * 6 - 3 - 50) + "px")
	bubble.textContent = label
	bubble.style.setProperty("--bubble-scale", "1.2")
	layer.append(bubble)
	bubble.addEventListener("animationend", () => bubble.remove(), {
		once: true,
	})
	window.setTimeout(() => bubble.remove(), lifetime * 1000 + 200)
}
export { emotionMotion, floatEmotion, floatKeyBubble }
