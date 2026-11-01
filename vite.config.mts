import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const projectRoot = fileURLToPath(new URL(".", import.meta.url))
const packageMetadata = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8")) as { version: string }
const buildVersion = process.env.BUILD_VERSION || new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12)

export default defineConfig({
	base: "./",
	plugins: [react()],
	define: {
		__APP_VERSION__: JSON.stringify(packageMetadata.version),
		__BUILD_VERSION__: JSON.stringify(buildVersion),
	},
	build: {
		outDir: "renderer-build",
		emptyOutDir: true,
		cssCodeSplit: false,
		rollupOptions: {
			input: {
				pet: resolve(projectRoot, "src/renderer/pet.tsx"),
				studio: resolve(projectRoot, "src/renderer/studio.tsx"),
			},
			output: {
				entryFileNames: "assets/[name].js",
				chunkFileNames: "assets/[name].js",
				assetFileNames: "assets/[name][extname]",
			},
		},
	},
})
