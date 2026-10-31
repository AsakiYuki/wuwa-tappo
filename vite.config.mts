import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: "src/renderer",
  plugins: [react()],
  base: "./",
  build: {
    outDir: "../../renderer-build",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        pet: resolve(projectRoot, "src/renderer/pet.html"),
        studio: resolve(projectRoot, "src/renderer/studio.html"),
      },
    },
  },
});
