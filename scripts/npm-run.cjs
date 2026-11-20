const { execFileSync } = require("node:child_process")

/**
 * Runs `<pm> run <script>` portably, reusing whichever package manager/runtime launched us:
 * - Bun: `process.execPath` is bun (or its `node` shim), and `npm_execpath` is unset.
 * - npm/pnpm/yarn: `npm_execpath` points at their JS entry point, run with the current Node. This
 *   avoids Windows .cmd shims, which Node only starts through a shell.
 * Falls back to `npm` on PATH otherwise.
 *
 * Also usable as a CLI from package.json: `node scripts/npm-run.cjs <script> [<script>...]`.
 */
function npmRun(script, cwd) {
	const opts = { cwd, stdio: "inherit" }
	if (process.versions.bun) {
		// Inside `bun run`, `node` is a renamed copy of bun acting only as Node, so call bun itself.
		const isNodeShim = /^node(\.exe)?$/i.test(require("node:path").basename(process.execPath))
		execFileSync(isNodeShim ? "bun" : process.execPath, ["run", script], opts)
		return
	}
	const execPath = process.env.npm_execpath
	if (execPath) {
		if (/\.[cm]?js$/i.test(execPath)) {
			execFileSync(process.execPath, [execPath, "run", script], opts)
		} else {
			execFileSync(execPath, ["run", script], opts)
		}
		return
	}
	execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", script], {
		...opts,
		shell: process.platform === "win32",
	})
}

module.exports = npmRun

if (require.main === module) {
	try {
		for (const script of process.argv.slice(2)) {
			npmRun(script, process.cwd())
		}
	} catch (error) {
		process.exit(typeof error.status === "number" ? error.status : 1)
	}
}
