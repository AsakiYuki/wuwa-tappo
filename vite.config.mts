import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [react()],
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
});
