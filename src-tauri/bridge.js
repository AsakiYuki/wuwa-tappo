// Injected before the page's own scripts: `window.petAPI` (PetAPI in src/domain/types.ts) on top of
// Tauri's IPC, for both the pet and the studio window.
;(() => {
	const tauri = () => window.__TAURI__
	const invoke = (cmd, args) => tauri().core.invoke(cmd, args)
	const listen = channel => callback => {
		tauri().event.listen(channel, event => callback(event.payload))
	}
	const platform = /Mac/.test(navigator.platform) ? "darwin" : /Win/.test(navigator.platform) ? "win32" : "linux"

	window.petAPI = {
		platform,
		init: () => invoke("init"),
		command: (name, argument) => invoke("command", { name, argument: argument ?? null }),
		onPage: listen("page"),
		onState: listen("state"),
		onInput: listen("input"),
		onEmote: listen("emote"),
		onStatus: listen("status"),
		onCursor: listen("cursor"),
		resizeWindow: (edge, dx, dy) => void invoke("resize_studio_edge", { edge, dx, dy }),
		move: (dx, dy) => void invoke("move_pet", { dx, dy }),
		setHoverArea: area => void invoke("set_hover_area", { area }),
		// Online mode (src-tauri/src/online.rs). Only the studio may call these.
		online: {
			request: (method, endpoint, body) => invoke("online_request", { method, endpoint, body: body ?? null }),
			status: () => invoke("online_status"),
			loginStart: lang => invoke("online_login_start", { lang: lang ?? null }),
			loginChoose: index => invoke("online_login_choose", { index }),
			roomConnect: (roomNo, selfId) => invoke("online_room_connect", { roomNo, selfId }),
			roomLeave: () => invoke("online_room_leave"),
			roomChanged: () => invoke("online_room_changed"),
			roomShowMember: (userId, shown) => invoke("online_room_show_member", { userId, shown }),
			roomMember: (action, userId) => invoke("online_room_member", { action, userId }),
			onRoomError: listen("room-error"),
			onRoomMembers: listen("room-members"),
			onRoomStatus: listen("room-status"),
			onRoomEmote: listen("room-emote"),
			loginSwitch: () => invoke("online_login_switch"),
			loginCancel: () => invoke("online_login_cancel"),
			onLogin: listen("online-login"),
		},
	}

	// Pressing the studio's title bar and moving the pointer a few pixels starts a native window drag.
	// Starting on the press itself would hand the pointer to the window manager, and the page's double-click
	// (maximize) would never arrive.
	const DRAG_REGION = ".panel-drag"
	const DRAG_THRESHOLD = 4
	let press = null
	window.addEventListener(
		"mousedown",
		event => {
			press =
				event.button === 0 && event.target.closest?.(DRAG_REGION)
					? { x: event.screenX, y: event.screenY }
					: null
		},
		true,
	)
	window.addEventListener(
		"mousemove",
		event => {
			if (!press || !(event.buttons & 1)) return (press = null)
			if (Math.hypot(event.screenX - press.x, event.screenY - press.y) < DRAG_THRESHOLD) return
			press = null
			void tauri().window.getCurrentWindow().startDragging()
		},
		true,
	)
	window.addEventListener("mouseup", () => (press = null), true)

	// Wayland windows cannot move themselves, so the studio's edge handles (which resize by moving
	// the window's origin) hand the resize to the compositor instead.
	const RESIZE_DIRECTIONS = {
		n: "North",
		s: "South",
		e: "East",
		w: "West",
		ne: "NorthEast",
		nw: "NorthWest",
		se: "SouthEast",
		sw: "SouthWest",
	}
	if (window.__WUWA_WAYLAND__) {
		// On KDE the app drags the pet by the real cursor and needs to know when the drag ends.
		for (const type of ["pointerup", "pointercancel"])
			window.addEventListener(type, () => void invoke("end_pet_drag"), true)
		window.addEventListener(
			"pointerdown",
			event => {
				const handle = event.button === 0 && event.target.closest?.(".resize-handle")
				const edge = handle && [...handle.classList].find(name => name.startsWith("resize-") && name !== "resize-handle")
				const direction = edge && RESIZE_DIRECTIONS[edge.slice("resize-".length)]
				if (!direction) return
				event.preventDefault()
				event.stopPropagation()
				void tauri().window.getCurrentWindow().startResizeDragging(direction)
			},
			true,
		)
	}
})()
