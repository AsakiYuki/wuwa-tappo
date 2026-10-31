const fs = require("node:fs");
const path = require("node:path");

const runtimeDirectory = path.resolve(__dirname, "../runtime");
fs.rmSync(runtimeDirectory, { recursive: true, force: true });
