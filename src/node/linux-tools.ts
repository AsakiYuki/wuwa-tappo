import fs from "node:fs"
import path from "node:path"

/*
 * Linux helper programs live in different places and under different names across distributions
 * (FHS distros, NixOS profiles, Plasma 5 vs 6 tool names), so they are looked up instead of assumed.
 */

/** Absolute path of the first executable named `name` on `searchPath`, or null. */
export function findExecutable(name: string, searchPath = process.env.PATH ?? ""): string | null {
	if (name.includes("/")) return isExecutable(name) ? name : null
	for (const directory of searchPath.split(path.delimiter)) {
		if (!directory) continue
		const candidate = path.join(directory, name)
		if (isExecutable(candidate)) return candidate
	}
	return null
}

function isExecutable(file: string) {
	try {
		return fs.statSync(file).isFile() && (fs.accessSync(file, fs.constants.X_OK), true)
	} catch {
		return false
	}
}

let qdbusPath: string | null | undefined

/**
 * The Qt D-Bus CLI: `qdbus6` (Arch, Debian/Ubuntu with Plasma 6), `qdbus-qt6` (Fedora) or plain
 * `qdbus` (NixOS, Plasma 5 distros). Any of them can talk to KWin. Cached after the first lookup.
 */
export function qdbusCommand(): string | null {
	if (qdbusPath === undefined)
		qdbusPath = ["qdbus6", "qdbus-qt6", "qdbus"].map(name => findExecutable(name)).find(Boolean) ?? null
	return qdbusPath
}
