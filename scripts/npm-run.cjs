const { execFileSync } = require("node:child_process")

/**
 * Runs `npm run <script>` portably. On Windows npm is a .cmd shim, which Node only starts through a
 * shell; running npm's own JavaScript entry point with the current Node avoids that entirely.
 */
module.exports = function npmRun(script, cwd) {
	const npmCli = process.env.npm_execpath
	if (npmCli && /npm-cli\.js$/.test(npmCli)) {
		execFileSync(process.execPath, [npmCli, "run", script], { cwd, stdio: "inherit" })
		return
	}
	execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", script], {
		cwd,
		stdio: "inherit",
		shell: process.platform === "win32",
	})
}
