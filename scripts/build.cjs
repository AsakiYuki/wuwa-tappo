const { execFileSync } = require("node:child_process")
const path = require("node:path")
const npmRun = require("./npm-run.cjs")

/*
 * Packages the app with electron-builder for the host OS. Output goes to dist/; the package
 * formats per OS are set in package.json → build.{mac,linux,win}.target.
 *
 *   npm run build                   current OS, current/default arch
 *   npm run build -- --win          cross-build another OS (--mac, --linux, --win)
 *   npm run build -- --arm64        pick arch(es): --x64, --arm64, --universal (mac), --all
 *
 * Any other argument is passed through to electron-builder.
 */

const projectRoot = path.resolve(__dirname, "..")
const HOST = { darwin: "mac", linux: "linux", win32: "win" }[process.platform]
const PLATFORM_FLAGS = { "--mac": "mac", "--darwin": "mac", "--linux": "linux", "--win": "win", "--windows": "win" }
const ARCH_FLAGS = new Set(["--x64", "--arm64", "--universal"])

let target = HOST
let archs = []
const extraArgs = []
for (const arg of process.argv.slice(2)) {
	if (PLATFORM_FLAGS[arg]) target = PLATFORM_FLAGS[arg]
	else if (ARCH_FLAGS.has(arg)) archs.push(arg)
	else if (arg === "--all") archs = ["--x64", "--arm64"]
	else extraArgs.push(arg)
}

if (!target) throw new Error(`Unsupported host platform: ${process.platform}. Wuwa Tappo supports Windows, macOS and Linux.`)
if (target === "mac" && HOST !== "mac") throw new Error("macOS packages can only be built on macOS.")
if (target !== HOST) {
	console.warn(
		target === "win"
			? "Warning: cross-building Windows packages needs Wine, and a MinGW-w64 compiler for controller support."
			: "Warning: building Linux packages on a non-Linux host may have limitations with AppImage/deb/rpm.",
	)
}
if (archs.length === 0) archs = [target === "mac" && process.arch === "arm64" ? "--arm64" : "--x64"]

console.log(`Building for ${target} (${archs.join(" ")})...`)

// node:build compiles the XInput watcher on Windows hosts; cross-builds have to force it.
if (target === "win" && HOST !== "win") {
	execFileSync(process.execPath, [path.join(__dirname, "build-win-gamepad.cjs"), "--force"], {
		cwd: projectRoot,
		stdio: "inherit",
	})
}

npmRun("node:build", projectRoot)
npmRun("renderer:build", projectRoot)

const builderArgs = [`--${target}`, ...archs, "--publish", "never", ...extraArgs]
console.log(`electron-builder ${builderArgs.join(" ")}`)
execFileSync(process.execPath, [path.join(projectRoot, "node_modules", "electron-builder", "cli.js"), ...builderArgs], {
	cwd: projectRoot,
	stdio: "inherit",
})
