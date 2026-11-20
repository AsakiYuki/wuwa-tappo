import type { BrowserWindow } from "electron"
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { qdbusCommand } from "./linux-tools.js"

/*
 * Linux window managers ignore Electron's skip-taskbar and always-on-top hints in various ways.
 * Everything here is best effort: missing tools or unsupported desktops are silently skipped.
 */

const KWIN_RULES_FILE = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "kwinrulesrc")
const KWIN_RULE_GROUP = "wuwa-tappo-pet"
export const PET_WINDOW_TITLE = "Wuwa Tappo · Desktop Pet"
const TOOL_TIMEOUT_MS = 1500

function kwinRule(alwaysOnTop: boolean) {
	return [
		"",
		`[${KWIN_RULE_GROUP}]`,
		"Description=Wuwa Tappo Pet",
		`above=${alwaysOnTop}`,
		"aboverule=2",
		"noborder=true",
		"noborderrule=2",
		"skiptaskbar=true",
		"skiptaskbarrule=2",
		"skippager=true",
		"skippagerrule=2",
		`title=${PET_WINDOW_TITLE}`,
		"titlematch=1",
		"types=1",
		"",
	].join("\n")
}

function reconfigureKWin() {
	// qdbus is optional; KWin picks the rule up on its own eventually.
	const qdbus = qdbusCommand()
	if (qdbus) execFile(qdbus, ["org.kde.KWin", "/KWin", "reconfigure"], { timeout: TOOL_TIMEOUT_MS }, () => {})
}

/** Keeps a KDE window rule for the pet (no border, no taskbar entry, optional keep-above) in sync. */
export function updateKdeWindowRule(alwaysOnTop: boolean) {
	if (process.platform !== "linux") return
	try {
		if (!fs.existsSync(KWIN_RULES_FILE)) return
		const content = fs.readFileSync(KWIN_RULES_FILE, "utf8")

		let updated: string
		if (!content.includes(`[${KWIN_RULE_GROUP}]`)) {
			updated =
				content
					.replace(/(rules=[^\n]+)/, `$1,${KWIN_RULE_GROUP}`)
					.replace(/(count=)(\d+)/, (_, prefix, count) => prefix + (Number(count) + 1)) +
				kwinRule(alwaysOnTop)
		} else {
			const aboveLine = new RegExp(`(\\[${KWIN_RULE_GROUP}\\][\\s\\S]*?\\nabove=)(true|false)`)
			updated = content.replace(aboveLine, (_, prefix) => prefix + alwaysOnTop)
		}
		if (updated === content) return
		fs.writeFileSync(KWIN_RULES_FILE, updated)
		reconfigureKWin()
	} catch {
		// Unreadable or unwritable rules file: nothing to do.
	}
}

function isX11Session() {
	return (
		Boolean(process.env.DISPLAY) &&
		(process.env.ELECTRON_OZONE_PLATFORM_HINT === "x11" || process.argv.includes("--ozone-platform=x11"))
	)
}

/** Falls back to editing `_NET_WM_STATE` directly when wmctrl is not installed. */
function addSkipStatesWithXprop(windowId: string) {
	execFile("xprop", ["-id", windowId, "_NET_WM_STATE"], { timeout: TOOL_TIMEOUT_MS }, (error, output) => {
		if (error) return
		const current = output.match(/_NET_WM_STATE\(ATOM\)\s*=\s*(.*)/)?.[1]
		const atoms =
			current && current !== "not found."
				? current
						.split(",")
						.map(atom => atom.trim())
						.filter(Boolean)
				: []
		for (const atom of ["_NET_WM_STATE_SKIP_TASKBAR", "_NET_WM_STATE_SKIP_PAGER"])
			if (!atoms.includes(atom)) atoms.push(atom)
		const args = ["-id", windowId, "-f", "_NET_WM_STATE", "32a", "-set", "_NET_WM_STATE", atoms.join(", ")]
		execFile("xprop", args, { timeout: TOOL_TIMEOUT_MS }, () => {})
	})
}

/** Hides the window from the taskbar and pager on X11, where the Electron hint is not always honoured. */
export function skipTaskbarOnX11(window: BrowserWindow) {
	if (!isX11Session()) return
	try {
		const windowId = `0x${window.getNativeWindowHandle().readUInt32LE(0).toString(16)}`
		if (windowId === "0x0") return
		const args = ["-ir", windowId, "-b", "add,skip_taskbar,skip_pager"]
		execFile("wmctrl", args, { timeout: TOOL_TIMEOUT_MS }, error => {
			if (error) addSkipStatesWithXprop(windowId)
		})
	} catch {
		// The native handle is unavailable before the window is realised.
	}
}
