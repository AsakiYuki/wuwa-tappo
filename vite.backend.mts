import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

/*
 * Bundles the shared game logic (src/backend) into one plain script for the Tauri port, which runs
 * it in QuickJS. Written next to the staged frontend; see scripts/tauri-prepare.cjs.
 */

const projectRoot = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig({
	build: {
		outDir: resolve(projectRoot, "src-tauri/frontend"),
		emptyOutDir: false,
		minify: false,
		target: "es2022",
		lib: {
			entry: resolve(projectRoot, "src/backend/index.ts"),
			formats: ["iife"],
			name: "WuwaBackendBundle",
			fileName: () => "backend.js",
		},
	},
})
