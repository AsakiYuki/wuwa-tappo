# Tauri prototype

A Tauri v2 (system WebView) build of the **pet window only**, to check whether Wuwa Tappo can drop
Electron. The Vue pet renders unchanged: `bridge.js` re-creates `window.petAPI` on Tauri's IPC.

Covered: transparent frameless always-on-top window off the taskbar, click-through with cursor
forwarding (hover-fade), dragging, tray (click-through toggle, quit), global keyboard/mouse hook (rdev).

Not covered: the studio window, saving, gacha/emote logic, controllers, autostart, KWin tweaks.
The prototype reads the Electron app's `collection.json` **read-only**; run the Electron app once first.

## Run

```bash
node scripts/tauri-prepare.cjs        # builds the renderer and stages src-tauri/frontend
cd src-tauri && cargo run             # or: cargo run --release
```

Windows needs either the MSVC C++ build tools, or the GNU toolchain with MinGW:
`rustup toolchain install stable-x86_64-pc-windows-gnu`, `scoop install mingw`, then
`cargo +stable-x86_64-pc-windows-gnu run`.

Linux needs `libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libx11-dev libxtst-dev libxi-dev`.
macOS: grant Accessibility permission for the global input hook.

Installers for all three OSes: the `Tauri prototype` GitHub Actions workflow.
