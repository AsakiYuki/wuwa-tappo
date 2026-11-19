// vue-tsc drives the TypeScript JS API, which the native TypeScript 7 compiler no longer ships.
// The renderer is therefore checked with a TypeScript 5 copy installed under the "typescript-vue" alias.
require("vue-tsc").run(require.resolve("typescript-vue/lib/tsc"))
