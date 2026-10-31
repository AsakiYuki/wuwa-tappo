const { execFileSync } = require("node:child_process");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const buildScripts = ["node:build", "renderer:build"];

if (process.platform !== "linux" || process.arch !== "x64") {
  throw new Error("Build Linux packages on Linux x64.");
}

for (const script of buildScripts) {
  execFileSync("npm", ["run", script], {
    cwd: projectRoot,
    stdio: "inherit",
  });
}

const electronBuilder = path.join(
  projectRoot,
  "node_modules",
  ".bin",
  "electron-builder",
);

execFileSync(
  electronBuilder,
  [
    "--linux",
    "deb",
    "rpm",
    "AppImage",
    "tar.gz",
    "--x64",
    "--publish",
    "never",
  ],
  {
    cwd: projectRoot,
    stdio: "inherit",
  },
);
