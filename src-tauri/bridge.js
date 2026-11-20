// Injected before the page's own scripts: re-creates Electron's `window.petAPI` (src/node/preload.ts)
// on top of Tauri's IPC, so the Vue renderer runs unchanged.
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
		resizeWindow: () => {},
		move: (dx, dy) => void invoke("move_pet", { dx, dy }),
		setHoverArea: area => void invoke("set_hover_area", { area }),
	}
})()
