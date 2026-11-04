# Wuwa Tappo

Wuwa Tappo is a Linux desktop companion app inspired by the Wuthering Waves desktop pet experience. This project is an enhanced, open-source adaptation of the original concept, built for better Linux compatibility, smoother desktop integration, and a more complete collection-management workflow.

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

- Linux
- Node.js 18+
- npm
- X11

## Installation

```bash
npm install
```

## Development

```bash
npm start
```

This builds the runtime and renderer, then launches the Electron app.

## Build

```bash
npm run build
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
