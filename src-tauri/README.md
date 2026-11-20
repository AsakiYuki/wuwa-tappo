# Tauri prototype

A Tauri v2 (system WebView) build of the **pet window only**, to check whether Wuwa Tappo can drop
Electron. The Vue pet renders unchanged: `bridge.js` re-creates `window.petAPI` on Tauri's IPC.

Covered: transparent frameless always-on-top window off the taskbar, click-through with cursor
forwarding (hover-fade), dragging, tray (click-through toggle, quit), global keyboard/mouse hook (rdev).

Not covered: the studio window, saving, gacha/emote logic, controllers, autostart, KWin tweaks.
The prototype reads the Electron app's `collection.json` **read-only**; run the Electron app once first.

## Run

On Windows, `bun start` (or `npm start`) builds and runs it. Elsewhere, `bun start -- --tauri`.

Windows needs either the MSVC C++ build tools, or the GNU toolchain with MinGW
(`rustup toolchain install stable-x86_64-pc-windows-gnu` and `scoop install mingw`); `start.cjs`
picks whichever is installed.

Linux needs `libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libx11-dev libxtst-dev libxi-dev`.
macOS: grant Accessibility permission for the global input hook.

Installers for all three OSes: the `Tauri prototype` GitHub Actions workflow.
