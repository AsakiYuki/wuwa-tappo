const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

/*
 * Builds assets/bin/win-gamepad-watcher.exe (XInput controller watcher).
 * On Windows it uses gcc/clang from PATH (MinGW, shipped on GitHub runners) or MSVC `cl`.
 * On Linux/macOS it cross-compiles when a MinGW-w64 compiler is available, e.g. for `--win` builds.
 * Set WUWA_WIN_CC to force a specific compiler. A missing compiler is a warning, not an error:
 * the app then runs without controller support on Windows.
 */

const projectRoot = path.resolve(__dirname, "..")
const srcFile = path.join(projectRoot, "src", "native", "win-gamepad-watcher.c")
const outDir = path.join(projectRoot, "assets", "bin")
const outFile = path.join(outDir, "win-gamepad-watcher.exe")
const force = process.argv.includes("--force")

if (process.platform !== "win32" && !force && !process.env.WUWA_WIN_CC) process.exit(0)

if (!fs.existsSync(srcFile)) {
	console.error("Source file not found:", srcFile)
	process.exit(1)
}

if (fs.existsSync(outFile) && fs.statSync(outFile).mtimeMs >= fs.statSync(srcFile).mtimeMs) {
	console.log("win-gamepad-watcher.exe is up to date")
	process.exit(0)
}

fs.mkdirSync(outDir, { recursive: true })

const gccFlags = ["-O2", "-s", srcFile, "-o", outFile]
const candidates = []
if (process.env.WUWA_WIN_CC) candidates.push([process.env.WUWA_WIN_CC, gccFlags])
if (process.platform === "win32") {
	candidates.push(["gcc", gccFlags], ["clang", gccFlags], ["cl", ["/nologo", "/O2", srcFile, `/Fe:${outFile}`]])
} else {
	candidates.push(["x86_64-w64-mingw32-gcc", gccFlags], ["clang", ["--target=x86_64-w64-mingw32", ...gccFlags]])
}

for (const [compiler, flags] of candidates) {
	try {
		execFileSync(compiler, flags, { stdio: ["ignore", "inherit", "pipe"], cwd: outDir })
		console.log(`win-gamepad-watcher.exe compiled with ${compiler}:`, outFile)
		process.exit(0)
	} catch {
		// Try the next compiler.
	}
}

console.warn(
	fs.existsSync(outFile)
		? "Could not recompile win-gamepad-watcher.exe (no C compiler found); keeping the prebuilt binary."
		: "Could not compile win-gamepad-watcher.exe (no C compiler found); controllers will not work on Windows.",
)
