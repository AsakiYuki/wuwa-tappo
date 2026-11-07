# Wuwa Tappo

Wuwa Tappo is a desktop companion app inspired by the Wuthering Waves desktop pet experience, built for Linux and macOS with smooth desktop integration and a complete collection-management workflow.

## Overview

This application brings together a floating desktop pet with a compact studio panel for managing characters, accessories, emotes, and outfit setups. It is designed for players who want a polished companion on their desktop without sacrificing collection and customization features.

## Highlights

- Floating desktop pet experience
- Character, accessory, and emote collection tracking
- Outfit preview and quick outfit switching
- Chest draws with pity tracking and pull history
- Synthesis and item management workflows
- Settings for startup, input, passthrough, and auto-emote behavior
- Linux-focused window and tray integration

## Why this version is different

This project is based on the original Wuwa Tappo concept, but it is optimized for Linux users and improved in several ways:

- better desktop and window behavior on Linux
- cleaner project structure and maintainability
- more configurable runtime settings
- focused collection and studio experience
- improved stability for desktop use

## Tech Stack

- Electron
- React + TypeScript
- Vite
- Node.js
- uiohook-napi

## Requirements

- Linux or macOS
- Node.js 18+
- npm
- On Linux: X11 or Wayland
- On macOS: Accessibility permission for global input tracking (System Settings > Privacy & Security > Accessibility)

## Installation

```bash
npm install
```

## Development

Start on your current platform:

```bash
npm start
```

Or target a specific platform:

```bash
# macOS
npm run start:mac

# Linux
npm run start:linux
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
```

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
