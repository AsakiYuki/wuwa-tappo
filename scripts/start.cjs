const { execFileSync, spawn } = require("node:child_process")
const path = require("node:path")
const npmRun = require("./npm-run.cjs")

const projectRoot = path.resolve(__dirname, "..")

const rawArgs = process.argv.slice(2)
let targetPlatform = { darwin: "mac", win32: "win" }[process.platform] || "linux"
const extraArgs = []

for (const arg of rawArgs) {
	if (arg === "--mac" || arg === "--darwin") {
		targetPlatform = "mac"
	} else if (arg === "--linux") {
		targetPlatform = "linux"
	} else if (arg === "--win" || arg === "--windows") {
		targetPlatform = "win"
	} else {
		extraArgs.push(arg)
	}
}

if (targetPlatform === "linux" && process.platform === "linux") {
	try {
		execFileSync("node", ["scripts/register-dev-desktop.cjs"], {
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
const args = targetPlatform === "linux" && process.platform === "linux" ? ["--ozone-platform=x11", "."] : ["."]
if (extraArgs.length > 0) {
	args.push(...extraArgs)
}

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
