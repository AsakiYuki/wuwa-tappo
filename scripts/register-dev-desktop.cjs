const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

if (process.platform !== "linux") {
	process.exit(0)
}

const projectRoot = path.resolve(__dirname, "..")
const packageMetadata = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"))
const xdgDataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
const appDataDirectory = path.join(xdgDataHome, "wuwa-tappo-dev")
const applicationsDirectory = path.join(xdgDataHome, "applications")
const desktopName = packageMetadata.desktopName || packageMetadata.name
const iconPath = path.join(appDataDirectory, "appicon.png")
const launcherPath = path.join(appDataDirectory, "launch.sh")
const desktopPath = path.join(applicationsDirectory, `${desktopName}-dev.desktop`)

function writeIfChanged(filePath, contents, options) {
	if (fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8") === contents) return false
	fs.writeFileSync(filePath, contents, options)
	return true
}

function quoteShell(value) {
	return `'${value.replace(/'/g, "'\\''")}'`
}

function quoteDesktopArg(value) {
	return `"${value.replace(/[\\"`$]/g, "\\$&")}"`
}

fs.mkdirSync(appDataDirectory, { recursive: true })
fs.mkdirSync(applicationsDirectory, { recursive: true })
const sourceIcon = path.join(projectRoot, "assets", "appicon.png")
const icon = fs.readFileSync(sourceIcon)
if (!fs.existsSync(iconPath) || !fs.readFileSync(iconPath).equals(icon)) fs.writeFileSync(iconPath, icon)

function commandExists(command) {
	return (process.env.PATH || "")
		.split(path.delimiter)
		.some(directory => directory && fs.existsSync(path.join(directory, command)))
}

/** Nix users get the dev shell's libraries; everyone else starts with the package manager they used. */
function launchCommand() {
	const usingBun = /bun/.test(process.env.npm_execpath || "") || process.versions.bun
	const runner = usingBun && commandExists("bun") ? "bun start" : "npm start"
	if (commandExists("nix-shell"))
		return `exec nix-shell ${quoteShell(path.join(projectRoot, "shell.nix"))} --run '${runner}'`
	return `exec ${runner}`
}

writeIfChanged(launcherPath, `#!/bin/sh\nset -eu\ncd ${quoteShell(projectRoot)}\n${launchCommand()}\n`, {
	mode: 0o755,
})
fs.chmodSync(launcherPath, 0o755)

const desktopEntry = [
	"[Desktop Entry]",
	"Type=Application",
	`Name=${packageMetadata.build.productName}`,
	`Comment=${packageMetadata.description}`,
	`Exec=${quoteDesktopArg(launcherPath)}`,
	`Icon=${iconPath}`,
	"Terminal=false",
	"Categories=Utility;",
	`StartupWMClass=${desktopName}`,
	"",
].join("\n")
const desktopChanged = writeIfChanged(desktopPath, desktopEntry)

if (desktopChanged) {
	try {
		execFileSync("update-desktop-database", [applicationsDirectory], {
			stdio: "ignore",
		})
	} catch {}
	for (const command of ["kbuildsycoca6", "kbuildsycoca5"]) {
		try {
			execFileSync(command, ["--noincremental"], { stdio: "ignore" })
			break
		} catch {}
	}
}
