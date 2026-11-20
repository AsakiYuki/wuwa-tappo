import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { App } from "electron"
import { findExecutable } from "./linux-tools.js"

export function getLinuxAutoStartExecutable({
	isPackaged,
	appImagePath,
	executablePath,
	dataHome,
	launcher,
	stableLauncher,
}: {
	isPackaged: boolean
	appImagePath?: string
	executablePath: string
	dataHome: string
	/** Set by distribution wrappers (e.g. the Nix package) that run the app with a system Electron. */
	launcher?: string
	/** The same launcher reached through a profile path that survives upgrades, when there is one. */
	stableLauncher?: string | null
}) {
	if (launcher) return stableLauncher || launcher
	if (isPackaged) return appImagePath || executablePath
	return path.join(dataHome, "wuwa-tappo-dev", "launch.sh")
}

/**
 * A Nix store path changes on every upgrade and disappears after garbage collection, so the
 * autostart entry prefers the profile symlink on PATH (/run/current-system/sw/bin, ~/.nix-profile/bin,
 * /etc/profiles/per-user/...) that currently resolves to this very launcher.
 */
export function stableLauncherPath(launcher: string, searchPath = process.env.PATH ?? "") {
	if (!launcher.startsWith("/nix/store/")) return null
	const onPath = findExecutable(path.basename(launcher), searchPath)
	if (!onPath || onPath.startsWith("/nix/store/")) return null
	try {
		return fs.realpathSync(onPath) === fs.realpathSync(launcher) ? onPath : null
	} catch {
		return null
	}
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

/**
 * The executable to register as a login item. Electron's portable Windows build extracts itself to a
 * temp folder on every launch, so the login item must point at the original .exe instead.
 */
export function getLoginItemExecutable({
	platform,
	executablePath,
	portableExecutable,
}: {
	platform: NodeJS.Platform
	executablePath: string
	portableExecutable?: string
}) {
	if (platform === "win32" && portableExecutable) return portableExecutable
	return executablePath
}

export function setAutoStart(enabled: boolean, app: App) {
	if (process.platform === "linux") {
		const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
		const launcher = process.env.WUWA_TAPPO_LAUNCHER || undefined
		const executablePath = getLinuxAutoStartExecutable({
			isPackaged: app.isPackaged,
			appImagePath: process.env.APPIMAGE,
			executablePath: process.execPath,
			dataHome,
			launcher,
			stableLauncher: launcher && stableLauncherPath(launcher),
		})
		setLinuxAutoStart(enabled, app.getPath("appData"), executablePath)
		return
	}
	if (!app.isPackaged) return

	app.setLoginItemSettings({
		openAtLogin: enabled,
		path: getLoginItemExecutable({
			platform: process.platform,
			executablePath: process.execPath,
			portableExecutable: process.env.PORTABLE_EXECUTABLE_FILE,
		}),
		args: [],
	})
}
