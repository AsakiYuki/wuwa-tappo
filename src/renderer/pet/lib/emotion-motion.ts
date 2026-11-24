/* Spring-driven squash/stretch for emote buttons, ported from the original EmotionMenu constants. */

interface MotionState {
	button: HTMLButtonElement
	image: HTMLImageElement
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

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function spring(x: number, v: number, target: number, stiffness: number, damping: number, dt: number) {
	v += ((target - x) * stiffness - v * damping) * dt
	return [x + v * dt, v] as const
}

function setTarget(state: MotionState, x: number, y: number, r: number) {
	state.targetX = x
	state.targetY = y
	state.targetR = r
}

function createEmotionMotion() {
	const states = new Map<HTMLButtonElement, MotionState>()
	const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches
	let frame = 0
	let previous = performance.now()

	function forget(button: HTMLButtonElement, state: MotionState) {
		clearTimeout(state.releaseTimer)
		clearTimeout(state.returnTimer)
		states.delete(button)
	}

	function wake(state: MotionState) {
		state.active = true
		if (frame) return
		previous = performance.now()
		frame = requestAnimationFrame(tick)
	}

	function press(state: MotionState) {
		if (reduce || state.held) return
		clearTimeout(state.releaseTimer)
		clearTimeout(state.returnTimer)
		state.held = true
		state.pressedAt = performance.now()
		setTarget(state, 0.86, 0.72, -0.025)
		state.vy -= 0.8
		wake(state)
	}

	function release(state: MotionState) {
		if (!state.held) return
		state.held = false
		const delay = Math.max(0, 80 - (performance.now() - state.pressedAt))
		state.releaseTimer = window.setTimeout(() => {
			setTarget(state, 1.48, 1.2, 0.035)
			state.vx += 2.4
			state.vy += 3.3
			state.vr += 0.32
			wake(state)
			state.returnTimer = window.setTimeout(() => {
				setTarget(state, 1, 1, 0)
				wake(state)
			}, 115)
		}, delay)
	}

	function render(state: MotionState) {
		const { button, image } = state
		const x = clamp(state.x, 0.72, 1.72)
		const y = clamp(state.y, 0.62, 1.55)
		const q = clamp((state.vx - state.vy) * 0.022, -0.13, 0.13)
		const b = clamp(((x + y) * 0.5 - 1) / 0.42, -0.35, 1.25)
		const radii = [
			50 + b * 7 + q * 50,
			50 - b * 5 - q * 42,
			50 + b * 4 - q * 35,
			50 - b * 3 + q * 45,
			50 - q * 38,
			50 + q * 34,
			50 - b * 3 + q * 40,
			50 + b * 4 - q * 36,
		].map(value => `${clamp(value, 38, 64)}%`)
		const rotation = clamp(state.r + (state.vx - state.vy) * 0.0025, -0.075, 0.075)
		button.style.transform = `scale(${x.toFixed(4)},${y.toFixed(4)}) rotate(${rotation.toFixed(4)}rad)`
		button.style.borderRadius = radii.slice(0, 4).join(" ") + " / " + radii.slice(4).join(" ")
		image.style.transform =
			`translateY(${((1 - y) * 3.5 - state.vy * 0.21).toFixed(2)}px) ` +
			`scale(${(1 - (x - 1) * 0.16).toFixed(3)},${(1 - (y - 1) * 0.13).toFixed(3)})`
	}

	function settle(state: MotionState) {
		const distance =
			Math.abs(state.x - state.targetX) +
			Math.abs(state.y - state.targetY) +
			Math.abs(state.r - state.targetR) +
			Math.abs(state.vx) +
			Math.abs(state.vy) +
			Math.abs(state.vr)
		if (distance >= 0.001) return
		state.active = false
		if (state.held) return
		state.button.style.transform = ""
		state.button.style.borderRadius = ""
		state.image.style.transform = ""
	}

	function tick(now: number) {
		frame = 0
		const dt = Math.min((now - previous) / 1000, 0.028)
		previous = now
		for (const [button, state] of states) {
			if (!button.isConnected) {
				forget(button, state)
				continue
			}
			if (!state.active) continue
			;[state.x, state.vx] = spring(state.x, state.vx, state.targetX, 245, 13.2, dt)
			;[state.y, state.vy] = spring(state.y, state.vy, state.targetY, 285, 14, dt)
			;[state.r, state.vr] = spring(state.r, state.vr, state.targetR, 205, 12.5, dt)
			render(state)
			settle(state)
		}
		if ([...states.values()].some(state => state.active)) frame = requestAnimationFrame(tick)
	}

	/** Attaches press/release springs to an emote button. Returns a cleanup function. */
	function bind(button: HTMLButtonElement, image: HTMLImageElement): () => void {
		const state: MotionState = {
			button,
			image,
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
		states.set(button, state)

		const onPointerDown = (event: PointerEvent) => {
			event.stopPropagation()
			button.setPointerCapture(event.pointerId)
			press(state)
		}
		const onPointerEnd = () => release(state)
		const isActivationKey = (event: KeyboardEvent) => event.key === " " || event.key === "Enter"
		const onKeyDown = (event: KeyboardEvent) => {
			if (!isActivationKey(event)) return
			event.preventDefault()
			press(state)
		}
		const onKeyUp = (event: KeyboardEvent) => {
			if (!isActivationKey(event)) return
			event.preventDefault()
			release(state)
			button.click()
		}

		button.addEventListener("pointerdown", onPointerDown)
		button.addEventListener("pointerup", onPointerEnd)
		button.addEventListener("pointercancel", onPointerEnd)
		button.addEventListener("pointerleave", onPointerEnd)
		button.addEventListener("keydown", onKeyDown)
		button.addEventListener("keyup", onKeyUp)
		return () => {
			button.removeEventListener("pointerdown", onPointerDown)
			button.removeEventListener("pointerup", onPointerEnd)
			button.removeEventListener("pointercancel", onPointerEnd)
			button.removeEventListener("pointerleave", onPointerEnd)
			button.removeEventListener("keydown", onKeyDown)
			button.removeEventListener("keyup", onKeyUp)
			forget(button, state)
		}
	}

	return {
		bind,
		reduce,
	}
}

export const emotionMotion = createEmotionMotion()
