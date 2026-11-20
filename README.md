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
- On Linux: X11 or Wayland
- On macOS: Accessibility permission for global input tracking (System Settings > Privacy & Security > Accessibility)
- On Windows: no extra permission is needed; Xbox-compatible (XInput) controllers are supported

## Installation

```bash
npm install
```

## Development

Start the app (the platform is detected automatically):

```bash
npm start
```

## Build

Build packages for your current operating system:

```bash
npm run build
```

Or target a specific platform:

```bash
# macOS (.dmg and .zip)
npm run build:mac

# Linux (deb, rpm, AppImage, tar.gz)
npm run build:linux

# Windows (NSIS installer and portable .exe)
npm run build:win
```

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
