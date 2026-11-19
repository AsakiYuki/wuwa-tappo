import { contextBridge, ipcRenderer } from "electron"
import type { PetAPI } from "./types.js"

// Sandboxed preloads may only require "electron", so this file must stay free of runtime imports.
const listen =
	<T>(channel: string) =>
	(callback: (payload: T) => void) => {
		ipcRenderer.on(channel, (_event, payload: T) => callback(payload))
	}

const api: PetAPI = {
	platform: process.platform,
	init: () => ipcRenderer.invoke("init"),
	command: (name, argument) => ipcRenderer.invoke("command", name, argument),
	onPage: listen("page"),
	onState: listen("state"),
	onInput: listen("input"),
	onEmote: listen("emote"),
	onStatus: listen("status"),
	onCursor: listen("cursor"),
	resizeWindow: (edge, dx, dy) => ipcRenderer.send("resize-studio", edge, dx, dy),
	move: (dx, dy) => ipcRenderer.send("move", dx, dy),
	setHoverArea: area => ipcRenderer.send("hover-area", area),
}

contextBridge.exposeInMainWorld("petAPI", api)
