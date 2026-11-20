const { execFileSync, spawn } = require("node:child_process")
const path = require("node:path")
const npmRun = require("./npm-run.cjs")

const projectRoot = path.resolve(__dirname, "..")
const platform = process.platform // "win32" | "darwin" | "linux" | ...

// Platform flags from the old start:mac/linux/win scripts are meaningless here (the app can only run
// on the host OS), so ignore them; every other argument is forwarded to Electron.
const legacyFlags = new Set(["--mac", "--darwin", "--linux", "--win", "--windows"])
const extraArgs = process.argv.slice(2).filter((arg) => !legacyFlags.has(arg))

console.log(`Starting on ${{ win32: "Windows", darwin: "macOS", linux: "Linux" }[platform] || platform}`)

if (platform === "linux") {
	try {
		execFileSync(process.execPath, [path.join(__dirname, "register-dev-desktop.cjs")], {
			cwd: projectRoot,
			stdio: "inherit",
		})
	} catch (error) {
		console.warn("Could not register dev desktop shortcut:", error)
	}
}

npmRun("node:build", projectRoot)
npmRun("renderer:build", projectRoot)

const electron = require("electron")
const args = [...(platform === "linux" ? ["--ozone-platform=x11"] : []), ".", ...extraArgs]

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electron, args, {
	cwd: projectRoot,
	stdio: "inherit",
	env,
})

child.on("exit", (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal)
	} else {
		process.exit(code ?? 0)
	}
})
