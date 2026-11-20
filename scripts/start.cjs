const { execFileSync, spawn } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const npmRun = require("./npm-run.cjs")

/*
 * `npm start` / `bun start`: builds and launches the app for the host OS.
 *   Windows, Linux   Tauri (src-tauri), unless --electron is passed
 *   macOS            Electron, until the Tauri port reaches it
 * On NixOS, it re-runs itself inside shell.nix (Rust toolchain, WebKitGTK, Electron) when not already
 * in a nix shell, so plain `bun start` works as well as `bun start:nix`.
 * On Linux, Tauri runs natively on Wayland when the session has it; pass --x11 to use XWayland.
 * Other arguments go to the app.
 */

const projectRoot = path.resolve(__dirname, "..")
const platform = process.platform

// Platform flags from the old start:mac/linux/win scripts are meaningless here (the app can only run
// on the host OS), so ignore them.
const ignoredFlags = new Set(["--mac", "--darwin", "--linux", "--win", "--windows", "--electron", "--tauri", "--x11"])
const rawArgs = process.argv.slice(2)
const extraArgs = rawArgs.filter(arg => !ignoredFlags.has(arg))
const tauriByDefault = platform === "win32" || platform === "linux"
const useTauri = rawArgs.includes("--tauri") || (tauriByDefault && !rawArgs.includes("--electron"))

const platformName = { win32: "Windows", darwin: "macOS", linux: "Linux" }[platform] || platform

// On NixOS outside a nix shell, the app is started again inside one; runAndExit forwards its exit code.
if (!reenterNixShell()) {
	console.log(`Starting on ${platformName} (${useTauri ? "Tauri" : "Electron"})`)
	if (useTauri) startTauri()
	else startElectron()
}

/**
 * NixOS has no global libraries, so the app needs shell.nix. Re-running there keeps the original
 * arguments; IN_NIX_SHELL (set by nix-shell and nix develop) prevents a loop.
 */
function reenterNixShell() {
	if (platform !== "linux" || process.env.IN_NIX_SHELL || !fs.existsSync("/etc/NIXOS")) return false
	const quote = value => `'${value.replace(/'/g, "'\\''")}'`
	const command = ["node", __filename, ...rawArgs].map(quote).join(" ")
	console.log("NixOS: entering shell.nix")
	runAndExit("nix-shell", [path.join(projectRoot, "shell.nix"), "--run", command])
	return true
}

/** Runs a child to completion and exits with its code; Ctrl+C reaches it through the shared console. */
function runAndExit(command, args, options) {
	const child = spawn(command, args, { cwd: projectRoot, stdio: "inherit", ...options })
	child.on("error", error => {
		console.error(`Could not start ${command}:`, error.message)
		process.exit(1)
	})
	child.on("exit", (code, signal) => {
		if (signal) process.kill(process.pid, signal)
		else process.exit(code ?? 0)
	})
}

/* --------------------------------- Tauri --------------------------------- */

function startTauri() {
	const cargo = findCargo()
	if (!cargo) {
		console.error(
			platform === "win32"
				? "Rust is not installed. Install it with `scoop install rustup` (or https://rustup.rs), then retry."
				: "Rust is not installed. Install it from https://rustup.rs (or use `bun start:nix` on Nix), then retry.",
		)
		process.exit(1)
	}

	execFileSync(process.execPath, [path.join(__dirname, "tauri-prepare.cjs")], { cwd: projectRoot, stdio: "inherit" })

	const env = { ...process.env }
	if (platform === "win32") {
		// Scoop keeps rustup's data beside .cargo instead of in ~/.rustup; a terminal opened before the
		// install lacks the variables pointing there.
		env.CARGO_HOME ||= path.dirname(path.dirname(cargo))
		const siblingRustup = path.join(path.dirname(env.CARGO_HOME), ".rustup")
		if (!env.RUSTUP_HOME && fs.existsSync(siblingRustup)) env.RUSTUP_HOME = siblingRustup
	}
	if (platform === "linux" && rawArgs.includes("--x11")) {
		// Native Wayland is the default (the pet becomes a layer-shell surface); --x11 runs through
		// XWayland instead, like the Electron build.
		env.GDK_BACKEND = "x11"
	}
	const toolchainArgs = []
	if (platform === "win32" && !hasMsvcBuildTools()) {
		// Without Visual Studio's C++ tools, link with the GNU toolchain and MinGW instead.
		const mingwBin = findMingwBin()
		if (!mingwBin) {
			console.error(
				"No C++ linker found. Either add 'Desktop development with C++' in Visual Studio, or run:\n" +
					"  rustup toolchain install stable-x86_64-pc-windows-gnu\n" +
					"  scoop install mingw",
			)
			process.exit(1)
		}
		env.Path = `${mingwBin}${path.delimiter}${env.Path || env.PATH || ""}`
		delete env.PATH
		toolchainArgs.push("+stable-x86_64-pc-windows-gnu")
	}

	const manifest = path.join(projectRoot, "src-tauri", "Cargo.toml")
	const runArgs = [...toolchainArgs, "run", "--manifest-path", manifest]
	if (extraArgs.length > 0) runArgs.push("--", ...extraArgs)
	runAndExit(cargo, runArgs, { env })
}

/** cargo on PATH, or in the usual install folders (a terminal opened before installing lacks the PATH entry). */
function findCargo() {
	const exe = platform === "win32" ? "cargo.exe" : "cargo"
	const dirs = [
		...(process.env.PATH || process.env.Path || "").split(path.delimiter),
		process.env.CARGO_HOME && path.join(process.env.CARGO_HOME, "bin"),
		path.join(os.homedir(), "scoop", "persist", "rustup", ".cargo", "bin"),
		path.join(os.homedir(), ".cargo", "bin"),
	]
	for (const dir of dirs) {
		if (dir && fs.existsSync(path.join(dir, exe))) return path.join(dir, exe)
	}
	return null
}

function hasMsvcBuildTools() {
	const vswhere = path.join(
		process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
		"Microsoft Visual Studio",
		"Installer",
		"vswhere.exe",
	)
	if (!fs.existsSync(vswhere)) return false
	try {
		const found = execFileSync(
			vswhere,
			[
				"-products",
				"*",
				"-requires",
				"Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
				"-property",
				"installationPath",
			],
			{ encoding: "utf8" },
		)
		return found.trim().length > 0
	} catch {
		return false
	}
}

function findMingwBin() {
	const dirs = [
		...(process.env.PATH || process.env.Path || "").split(path.delimiter),
		path.join(os.homedir(), "scoop", "apps", "mingw", "current", "bin"),
		"C:\\msys64\\mingw64\\bin",
	]
	return dirs.find(dir => dir && fs.existsSync(path.join(dir, "dlltool.exe"))) || null
}

/* -------------------------------- Electron ------------------------------- */

function startElectron() {
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

	const env = { ...process.env }
	delete env.ELECTRON_RUN_AS_NODE
	const args = [...(platform === "linux" ? ["--ozone-platform=x11"] : []), ".", ...extraArgs]
	runAndExit(require("electron"), args, { env })
}
