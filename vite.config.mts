import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vite"

const projectRoot = fileURLToPath(new URL(".", import.meta.url))
const packageMetadata = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8")) as { version: string }
const buildVersion = process.env.BUILD_VERSION || new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12)

export default defineConfig({
	base: "./",
	plugins: [vue()],
	define: {
		__APP_VERSION__: JSON.stringify(packageMetadata.version),
		__BUILD_VERSION__: JSON.stringify(buildVersion),
		// Templates are precompiled, so the runtime needs neither the Options API nor devtools hooks.
		__VUE_OPTIONS_API__: "false",
		__VUE_PROD_DEVTOOLS__: "false",
		__VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
	},
	build: {
		outDir: "renderer-build",
		emptyOutDir: true,
		cssCodeSplit: false,
		rollupOptions: {
			input: {
				pet: resolve(projectRoot, "src/renderer/pet/main.ts"),
				studio: resolve(projectRoot, "src/renderer/studio/main.ts"),
				room: resolve(projectRoot, "src/renderer/room/main.ts"),
			},
			output: {
				entryFileNames: "assets/[name].js",
				chunkFileNames: "assets/[name].js",
				assetFileNames: "assets/[name][extname]",
			},
		},
	},
})
