import fs from "node:fs"
import path from "node:path"
import type { App } from "electron"

export function setLinuxAutoStart(enabled: boolean, configDirectory: string, executablePath: string) {
	const directory = path.join(configDirectory, "autostart")
	const file = path.join(directory, "wuwa-tappo.desktop")

	if (!enabled) {
		fs.rmSync(file, { force: true })
		return
	}

	const escapedPath = executablePath.replace(/[\\`"$]/g, "\\$&")
	fs.mkdirSync(directory, { recursive: true })
	fs.writeFileSync(
		file,
		["[Desktop Entry]", "Type=Application", "Name=Wuwa Tappo", `Exec="${escapedPath}"`, "Terminal=false", ""].join(
			"\n",
		),
	)
}

export function setAutoStart(enabled: boolean, app: App) {
	if (!app.isPackaged) return

	if (process.platform === "linux") {
		setLinuxAutoStart(enabled, app.getPath("appData"), process.execPath)
		return
	}

	app.setLoginItemSettings({
		openAtLogin: enabled,
		path: process.execPath,
		args: [],
	})
}
