const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const srcFile = path.join(projectRoot, "src", "native", "mac-gamepad-watcher.c");
const outDir = path.join(projectRoot, "assets", "bin");
const outFile = path.join(outDir, "mac-gamepad-watcher");

if (process.platform !== "darwin") {
  // On non-macOS platforms, skip compilation
  process.exit(0);
}

if (!fs.existsSync(srcFile)) {
  console.error("Source file not found:", srcFile);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

try {
  console.log("Compiling mac-gamepad-watcher universal binary (arm64 + x86_64)...");
  execFileSync(
    "clang",
    [
      "-O2",
      "-arch",
      "arm64",
      "-arch",
      "x86_64",
      "-framework",
      "IOKit",
      "-framework",
      "CoreFoundation",
      srcFile,
      "-o",
      outFile,
    ],
    {
      stdio: "inherit",
    },
  );
  fs.chmodSync(outFile, 0o755);
  console.log("mac-gamepad-watcher compiled successfully at:", outFile);
} catch (error) {
  console.warn("Failed to compile universal binary, trying host arch only...", error.message);
  try {
    execFileSync(
      "clang",
      [
        "-O2",
        "-framework",
        "IOKit",
        "-framework",
        "CoreFoundation",
        srcFile,
        "-o",
        outFile,
      ],
      {
        stdio: "inherit",
      },
    );
    fs.chmodSync(outFile, 0o755);
    console.log("mac-gamepad-watcher compiled for host arch at:", outFile);
  } catch (err) {
    console.error("Could not compile mac-gamepad-watcher:", err);
  }
}
