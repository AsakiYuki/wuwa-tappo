# Wuwa Tappo

Wuwa Tappo is a desktop companion app inspired by the Wuthering Waves desktop pet experience, built for Windows, Linux and macOS with smooth desktop integration and a complete collection-management workflow.

## Overview

This application brings together a floating desktop pet with a compact studio panel for managing characters, accessories, emotes, and outfit setups. It is designed for players who want a polished companion on their desktop without sacrificing collection and customization features.

## Highlights

- Floating desktop pet experience
- Character, accessory, and emote collection tracking
- Outfit preview and quick outfit switching
- Chest draws with pity tracking and pull history
- Synthesis and item management workflows
- Settings for startup, input, passthrough, and auto-emote behavior
- Linux-focused window and tray integration, plus native Windows and macOS support
- Keyboard, mouse and controller input on every platform (evdev / IOKit / XInput)

## Why this version is different

This project is based on the original Wuwa Tappo concept, but it is optimized for Linux users and improved in several ways:

- better desktop and window behavior on Linux
- cleaner project structure and maintainability
- more configurable runtime settings
- focused collection and studio experience
- improved stability for desktop use

## Tech Stack

- Electron
- Vue 3 + TypeScript
- Vite
- Node.js
- uiohook-napi

## Requirements

- Windows 10/11, Linux or macOS
- Node.js 18+
- npm
- On Linux: X11 or Wayland (Wayland sessions run the app through XWayland); global input on Wayland needs read access to `/dev/input` (see [Linux](#linux))
- On macOS: Input Monitoring permission for global input tracking (System Settings > Privacy & Security > Input Monitoring); the Electron app asks for Accessibility instead
- On Windows: no extra permission is needed; Xbox-compatible (XInput) controllers are supported

## Linux

Any distribution works: use the AppImage / deb / rpm / tar.gz packages, or the Nix flake below.

**Global input on Wayland.** Wayland does not let apps see key presses for other windows, so the
pet reads `/dev/input/event*` directly. Grant access with the tray menu's
**Fix Input Permissions** (until reboot) or `./fix-permissions.sh`, which can also install
[`packaging/linux/70-wuwa-tappo-input.rules`](packaging/linux/70-wuwa-tappo-input.rules) permanently.
Either way, every program you run can then read raw keystrokes. Weigh that before enabling it.

**Desktop notes.**
- KDE Plasma 5/6: the pet gets a KWin window rule, and hover-fade uses KWin scripting
  (`qdbus`, `qdbus6` or `qdbus-qt6`, whichever is installed).
- GNOME: the tray icon needs the *AppIndicator and KStatusNotifierItem Support* extension.
- X11: install `wmctrl` (or `xprop`) so the pet stays off the taskbar on every window manager.

### NixOS / Nix

Run it without installing:

```bash
nix run github:AsakiYuki/wuwa-tappo
```

Install it system-wide with the NixOS module:

```nix
# flake.nix
{
  inputs.wuwa-tappo.url = "github:AsakiYuki/wuwa-tappo";

  outputs = { nixpkgs, wuwa-tappo, ... }: {
    nixosConfigurations.my-host = nixpkgs.lib.nixosSystem {
      modules = [
        wuwa-tappo.nixosModules.default
        {
          programs.wuwa-tappo.enable = true;
          # Global input on Wayland (see the security note above):
          programs.wuwa-tappo.inputAccess = true;
        }
      ];
    };
  };
}
```

For Home Manager or a plain profile, add `wuwa-tappo.overlays.default` and install
`pkgs.wuwa-tappo`, or use `wuwa-tappo.packages.${system}.default` directly.
Launch-at-startup points at the profile path (for example `/run/current-system/sw/bin/wuwa-tappo`),
so it keeps working after upgrades and garbage collection.

For development, `nix develop` (or `nix-shell`) provides Electron and the native libraries.
After changing `package-lock.json`, update `npmDepsHash` in [`nix/package.nix`](nix/package.nix):
set it to `lib.fakeHash`, run `nix build`, and copy the hash from the error.

## Installation

```bash
npm install
```

## Development

Start the app (the platform is detected automatically):

```bash
npm start
```

On Windows, Linux and macOS this runs the Tauri port (`src-tauri/`, needs [Rust](https://rustup.rs));
use `npm run start:electron` for the Electron app.

On NixOS, `bun start` and `bun start:nix` both work: outside a nix shell, `start.cjs` re-runs itself
inside `shell.nix`, which provides Rust, WebKitGTK and Electron. No rustup toolchain is needed.

## Build

Build packages for your current operating system (output in `dist/`):

```bash
npm run build
```

- Windows: `wuwa-tappo-<version>-x64-setup.exe` (installer) and `wuwa-tappo-<version>-x64-portable.exe`
- macOS: `.dmg` and `.zip`
- Linux: `.deb`, `.rpm`, `.AppImage` and `.tar.gz`

Flags: `--x64`, `--arm64`, `--all` pick the architecture; `--win` / `--linux` cross-build another OS
(e.g. `npm run build -- --arm64`). macOS packages can only be built on macOS.

Windows packages are best built on Windows. The controller watcher
(`assets/bin/win-gamepad-watcher.exe`) is committed prebuilt; to rebuild it, run
`node scripts/build-win-gamepad.cjs --force` with MinGW gcc, clang or MSVC on `PATH`
(on Linux, `x86_64-w64-mingw32-gcc` cross-compiles it).

## Testing

```bash
npm test
```

UI validation:

```bash
npm run test:ui
```

## Project Structure

```text
.
├── assets/
├── runtime/
├── scripts/
├── src/
├── renderer-build/
├── package.json
├── LICENSE
├── README.md
```

## License

This project is licensed under the terms in the [LICENSE](LICENSE) file.
