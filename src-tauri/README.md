# Tauri port

A Tauri v2 (system WebView) build of Wuwa Tappo: the desktop pet **and the studio** (collection,
atlas, synthesis, chests, presets, settings). The Vue pages render unchanged: `bridge.js` re-creates
Electron's `window.petAPI` on Tauri's IPC.

**Game logic is shared, not rewritten.** The Electron app's own TypeScript (`src/node/domain`) is
bundled by `vite.backend.mts` into `frontend/backend.js` and run in QuickJS (`src/backend.rs`), so
draws, pity, synthesis, equipping, presets and tap counting behave exactly as in Electron.

**Shared save.** It loads and writes the Electron app's `collection.json` the same way (temp file,
`.bak`, rename; a corrupt save is copied aside). Run only one of the two apps at a time; a second
launch of the Tauri app just brings the running one's studio forward.

Covered: transparent frameless always-on-top pet off the taskbar, click-through with cursor
forwarding (hover-fade), dragging (position is saved), the studio window (frameless: drag, resize
edges, maximize, zoom, hide), import/export dialogs, the Electron tray menu (collection, show/reset
pet, mouse passthrough, input on/off, Linux input-permission fix, exit; a click on the icon opens the
studio, on Linux through a StatusNotifierItem), global keyboard/mouse input (rdev; on Linux also
evdev, which works on Wayland), Ctrl/Meta+Alt+1…5 emote shortcuts, and controllers (XInput watcher on
Windows, evdev on Linux).

Not covered: launch at startup (the setting is saved but registers nothing), KWin hover-fade,
controllers on macOS.

## Run

On Windows and Linux, `bun start` (or `npm start`) builds and runs it; on macOS, `bun start -- --tauri`.

Windows needs either the MSVC C++ build tools, or the GNU toolchain with MinGW
(`rustup toolchain install stable-x86_64-pc-windows-gnu` and `scoop install mingw`); `start.cjs`
picks whichever is installed.

Linux needs `libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libx11-dev libxtst-dev libxi-dev libgtk-layer-shell-dev`.
On Wayland sessions it runs as a native Wayland client. Where the compositor supports wlr-layer-shell
(KDE Plasma, Hyprland, Sway, …) the pet is a layer surface: anchored to a screen corner, moved by
dragging, above windows when "always on top" is on, and never in the taskbar. Elsewhere (GNOME) it is
a normal window, which Wayland does not let the app place. `bun start -- --x11` runs it through XWayland
instead; `WUWA_TAPPO_LAYER_SHELL=0` keeps the pet a normal window on Wayland.
Hover-fade with mouse passthrough needs the global cursor position, which Wayland hides from apps:
on KDE Plasma a small KWin script sends it over D-Bus; other Wayland compositors have no fade while
passthrough is on. NixOS needs nothing installed:
`bun start` / `bun start:nix` enter `shell.nix`, which has the Rust toolchain and these libraries.
macOS: grant Accessibility permission for the global input hook.

Installers for all three OSes: the `Tauri prototype` GitHub Actions workflow.
