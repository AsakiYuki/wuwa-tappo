const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")
const npmRun = require("./npm-run.cjs")

/*
 * Stages the frontend the Tauri app embeds (src-tauri/frontend):
 *   web/     the Vite build (renderer-build), whose pages load images from ../assets/
 *   assets/  the catalog's images, so those relative paths resolve
 *   backend.js  the game logic (src/backend), embedded into the Rust binary
 * Pass --skip-build to reuse an existing renderer-build.
 */

const projectRoot = path.resolve(__dirname, "..")
const rendererBuild = path.join(projectRoot, "renderer-build")
const out = path.join(projectRoot, "src-tauri", "frontend")
const ASSET_DIRS = ["characters", "accessories", "emotes", "ui"]

if (!process.argv.includes("--skip-build") || !fs.existsSync(rendererBuild)) npmRun("renderer:build", projectRoot)

fs.rmSync(out, { recursive: true, force: true })
fs.cpSync(rendererBuild, path.join(out, "web"), { recursive: true })
for (const dir of ASSET_DIRS) {
	fs.cpSync(path.join(projectRoot, "assets", dir), path.join(out, "assets", dir), { recursive: true })
}

// The game logic, which the Rust side embeds and runs in QuickJS (src-tauri/src/backend.rs).
execFileSync(
	process.execPath,
	[
		path.join(projectRoot, "node_modules", "vite", "bin", "vite.js"),
		"build",
		"--config",
		"vite.backend.mts",
		"--logLevel",
		"warn",
	],
	{
		cwd: projectRoot,
		stdio: "inherit",
	},
)

console.log("Tauri frontend staged in", path.relative(projectRoot, out))
