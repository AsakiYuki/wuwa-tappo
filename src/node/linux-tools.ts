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

/**
 * Where programs that run as root (pkexec, setfacl) may come from. Never $PATH: any program running
 * as the user can put a directory in front of it, and a planted `setfacl` would then run as root
 * behind the polkit prompt. /run/wrappers/bin and /run/current-system/sw/bin are NixOS's.
 */
const SYSTEM_DIRECTORIES = ["/run/wrappers/bin", "/run/current-system/sw/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]

/**
 * The real path of a system executable that only root can change, or null. That path, not the
 * symlink that led to it, is what should be run, so the link cannot be swapped in between.
 */
export function findSystemExecutable(name: string, directories = SYSTEM_DIRECTORIES): string | null {
	for (const directory of directories) {
		let real: string
		try {
			real = fs.realpathSync(path.join(directory, name))
		} catch {
			continue
		}
		if (isExecutable(real) && isRootControlled(real)) return real
	}
	return null
}

/**
 * The file and every directory above it belong to root and nobody else can write to them; a
 * directory others may write to counts only with the sticky bit, which keeps them from replacing
 * root's entries (the Nix store).
 */
export function isRootControlled(file: string): boolean {
	for (let entry = file; ; entry = path.dirname(entry)) {
		let stats: fs.Stats
		try {
			stats = fs.statSync(entry)
		} catch {
			return false
		}
		const sharedWrite = (stats.mode & 0o022) !== 0
		const stickyDirectory = stats.isDirectory() && (stats.mode & 0o1000) !== 0
		if (stats.uid !== 0 || (sharedWrite && !stickyDirectory)) return false
		if (entry === path.dirname(entry)) return true
	}
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
