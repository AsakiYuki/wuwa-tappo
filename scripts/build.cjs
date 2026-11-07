const { execFileSync } = require("node:child_process");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const buildScripts = ["node:build", "renderer:build"];

const rawArgs = process.argv.slice(2);
let targetPlatform = null;
let archs = [];
const extraArgs = [];

for (const arg of rawArgs) {
  if (arg === "--mac" || arg === "--darwin") {
    targetPlatform = "mac";
  } else if (arg === "--linux") {
    targetPlatform = "linux";
  } else if (arg === "--arm64") {
    archs.push("--arm64");
  } else if (arg === "--x64") {
    archs.push("--x64");
  } else if (arg === "--universal") {
    archs.push("--universal");
  } else if (arg === "--all") {
    archs = ["--arm64", "--x64"];
  } else {
    extraArgs.push(arg);
  }
}

if (!targetPlatform) {
  if (process.platform === "darwin") {
    targetPlatform = "mac";
  } else if (process.platform === "linux") {
    targetPlatform = "linux";
  } else {
    throw new Error(`Unsupported host platform: ${process.platform}. Wuwa Tappo supports macOS and Linux.`);
  }
}

if (targetPlatform === "mac" && process.platform !== "darwin") {
  throw new Error("macOS packages can only be built on macOS.");
}

if (targetPlatform === "linux" && process.platform !== "linux") {
  console.warn("Warning: Building Linux packages on a non-Linux platform may have limitations with AppImage/deb/rpm packaging.");
}

console.log(`Starting build for ${targetPlatform}...`);

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

let builderArgs = [];

if (targetPlatform === "mac") {
  if (archs.length === 0) {
    archs = [process.arch === "arm64" ? "--arm64" : "--x64"];
  }
  builderArgs = [
    "--mac",
    "dmg",
    "zip",
    ...archs,
    "--publish",
    "never",
    ...extraArgs,
  ];
} else if (targetPlatform === "linux") {
  if (archs.length === 0) {
    archs = ["--x64"];
  }
  builderArgs = [
    "--linux",
    "deb",
    "rpm",
    "AppImage",
    "tar.gz",
    ...archs,
    "--publish",
    "never",
    ...extraArgs,
  ];
}

console.log(`Running electron-builder with arguments: ${builderArgs.join(" ")}`);

execFileSync(electronBuilder, builderArgs, {
  cwd: projectRoot,
  stdio: "inherit",
});
