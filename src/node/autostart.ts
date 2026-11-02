import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { App } from "electron"

export function getLinuxAutoStartExecutable({
	isPackaged,
	appImagePath,
	executablePath,
	dataHome,
}: {
	isPackaged: boolean
	appImagePath?: string
	executablePath: string
	dataHome: string
}) {
	if (isPackaged) return appImagePath || executablePath
	return path.join(dataHome, "wuwa-tappo-dev", "launch.sh")
}

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
	if (process.platform === "linux") {
		const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
		const executablePath = getLinuxAutoStartExecutable({
			isPackaged: app.isPackaged,
			appImagePath: process.env.APPIMAGE,
			executablePath: process.execPath,
			dataHome,
		})
		setLinuxAutoStart(enabled, app.getPath("appData"), executablePath)
		return
	}
	if (!app.isPackaged) return

	app.setLoginItemSettings({
		openAtLogin: enabled,
		path: process.execPath,
		args: [],
	})
}
