import { BrowserWindow, screen, type Tray } from "electron";
import { execFile, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CollectionState } from "./types.js";

interface WindowManagerOptions {
  preloadPath: string;
  rendererPath: string;
  selfTest: boolean;
  getState(): CollectionState;
  getPet(): BrowserWindow | null;
  setPet(window: BrowserWindow | null): void;
  getStudio(): BrowserWindow | null;
  setStudio(window: BrowserWindow | null): void;
  getTray(): Tray | null;
  isQuitting(): boolean;
  attachWindowInput(window: BrowserWindow): void;
  getContextMenu(): Electron.Menu;
}

export function createWindowManager(options: WindowManagerOptions) {
  let lastIgnoreMouseEvents: boolean | undefined;
  let studioRestoreBounds: Electron.Rectangle | null = null;

  const petIsUsable = () => {
    const pet = options.getPet();
    return pet && !pet.isDestroyed() ? pet : null;
  };

  function activeDisplay() {
    const displays = screen.getAllDisplays();
    return (
      displays[options.getState().settings.monitor] ??
      screen.getPrimaryDisplay()
    );
  }

  function placePet(resetToCorner = false) {
    const pet = petIsUsable();
    if (!pet) return;

    const settings = options.getState().settings;
    const workArea = activeDisplay().workArea;
    const width = Math.round(320 * settings.scale);
    const height = Math.round(350 * settings.scale);
    const savedPosition = settings.petPosition;

    if (
      !resetToCorner &&
      savedPosition &&
      Number.isFinite(savedPosition.x) &&
      Number.isFinite(savedPosition.y)
    ) {
      const savedDisplayArea = screen.getDisplayMatching({
        x: savedPosition.x,
        y: savedPosition.y,
        width,
        height,
      }).workArea;
      const x = Math.round(
        Math.max(
          savedDisplayArea.x,
          Math.min(
            savedPosition.x,
            savedDisplayArea.x + savedDisplayArea.width - width,
          ),
        ),
      );
      const y = Math.round(
        Math.max(
          savedDisplayArea.y,
          Math.min(
            savedPosition.y,
            savedDisplayArea.y + savedDisplayArea.height - height,
          ),
        ),
      );
      pet.setBounds({ x, y, width, height });
      settings.petPosition = { x, y };
      return;
    }

    const x = workArea.x + workArea.width - width - 24;
    const y = workArea.y + workArea.height - height - 12;
    pet.setBounds({ x, y, width, height });
    settings.petPosition = { x, y };
  }

  function updateKdeWindowRule() {
    if (process.platform !== "linux") return;

    try {
      const ruleFile = path.join(os.homedir(), ".config/kwinrulesrc");
      if (!fs.existsSync(ruleFile)) return;

      const alwaysOnTop = options.getState().settings.alwaysOnTop;
      let content = fs.readFileSync(ruleFile, "utf8");
      if (!content.includes("[wuwa-tappo-pet]")) {
        content = content.replace(/(rules=[^\n]+)/, "$1,wuwa-tappo-pet");
        content = content.replace(
          /(count=)(\d+)/,
          (_, prefix, count) => prefix + (Number(count) + 1),
        );
        content +=
          `\n[wuwa-tappo-pet]\nDescription=Wuwa Tappo Pet\nabove=${alwaysOnTop}\naboverule=2\n` +
          "noborder=true\nnoborderrule=2\nskiptaskbar=true\nskiptaskbarrule=2\n" +
          "skippager=true\nskippagerrule=2\ntitle=Wuwa Tappo · Desktop Pet\n" +
          "titlematch=1\ntypes=1\n";
        fs.writeFileSync(ruleFile, content);
        reconfigureKWin();
        return;
      }

      const updated = content.replace(
        /(\[wuwa-tappo-pet\][\s\S]*?\nabove=)(true|false)/,
        (_, prefix) => prefix + alwaysOnTop,
      );
      if (updated === content) return;
      fs.writeFileSync(ruleFile, updated);
      reconfigureKWin();
    } catch {
      // KDE window rules are best-effort; unsupported desktops need no action.
    }
  }

  function reconfigureKWin() {
    try {
      execSync("qdbus org.kde.KWin /KWin reconfigure");
    } catch {
      // qdbus is optional, and KWin applies the rule on its own eventually.
    }
  }

  function applySkipTaskbar() {
    const pet = petIsUsable();
    if (!pet) return;

    if (process.platform !== "linux") {
      pet.setSkipTaskbar(true);
      return;
    }

    updateKdeWindowRule();
    const isX11 =
      Boolean(process.env.DISPLAY) &&
      (process.env.ELECTRON_OZONE_PLATFORM_HINT === "x11" ||
        process.argv.includes("--ozone-platform=x11"));
    if (!isX11) return;

    try {
      const handle = pet.getNativeWindowHandle();
      const windowId = `0x${handle.readUInt32LE(0).toString(16)}`;
      if (windowId === "0x0") return;
      execFile(
        "wmctrl",
        ["-ir", windowId, "-b", "add,skip_taskbar,skip_pager"],
        { timeout: 1500 },
        () => {},
      );
    } catch {
      // wmctrl is optional on Linux.
    }
  }

  function keepPetOnTop() {
    const pet = petIsUsable();
    if (!pet || !pet.isVisible() || !options.getState().settings.alwaysOnTop)
      return;

    pet.setAlwaysOnTop(true, "screen-saver", 1);
    pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    applySkipTaskbar();
    pet.moveTop();
  }

  function updateMousePassthrough() {
    const pet = petIsUsable();
    if (!pet) return;

    const shouldIgnoreMouse = Boolean(options.getState().settings.passthrough);
    if (shouldIgnoreMouse === lastIgnoreMouseEvents) return;
    pet.setIgnoreMouseEvents(shouldIgnoreMouse, { forward: true });
    lastIgnoreMouseEvents = shouldIgnoreMouse;
  }

  function applySettings() {
    const pet = petIsUsable();
    if (!pet) return;

    const settings = options.getState().settings;
    if (process.platform === "linux") updateKdeWindowRule();
    pet.setAlwaysOnTop(
      settings.alwaysOnTop,
      settings.alwaysOnTop ? "screen-saver" : "normal",
      1,
    );
    pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (settings.alwaysOnTop) keepPetOnTop();
    pet.setOpacity(settings.opacity);
    updateMousePassthrough();
    options.getTray()?.setContextMenu(options.getContextMenu());
  }

  function fitStudio(bounds: Electron.Rectangle): Electron.Rectangle {
    const area = screen.getDisplayMatching(bounds).workArea;
    const width = Math.round(
      Math.max(Math.min(680, area.width), Math.min(bounds.width, area.width)),
    );
    const height = Math.round(
      Math.max(
        Math.min(468, area.height),
        Math.min(bounds.height, area.height),
      ),
    );
    return {
      x: Math.round(
        Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
      ),
      y: Math.round(
        Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)),
      ),
      width,
      height,
    };
  }

  function resizeStudio(action: string) {
    const studio = options.getStudio();
    if (!studio || studio.isDestroyed()) return;

    if (action === "minimize") {
      studio.minimize();
      return;
    }

    const bounds = studio.getBounds();
    if (action === "maximize") {
      if (studioRestoreBounds) {
        studio.setBounds(fitStudio(studioRestoreBounds));
        studioRestoreBounds = null;
      } else {
        studioRestoreBounds = bounds;
        studio.setBounds(screen.getDisplayMatching(bounds).workArea);
      }
      return;
    }

    if (action === "smaller" || action === "larger") {
      const factor = action === "larger" ? 1.1 : 1 / 1.1;
      studioRestoreBounds = null;
      studio.setBounds(
        fitStudio({
          ...bounds,
          width: bounds.width * factor,
          height: bounds.height * factor,
        }),
      );
    }
  }

  function secureWindow(window: BrowserWindow) {
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
  }

  function clearStudioRestoreBounds() {
    studioRestoreBounds = null;
  }

  function showStudio() {
    const existing = options.getStudio();
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.setBounds(fitStudio(existing.getBounds()));
      existing.show();
      existing.focus();
      return;
    }

    const area = screen.getPrimaryDisplay().workArea;
    const studio = new BrowserWindow({
      width: Math.min(1100, area.width - 50),
      height: Math.min(756, area.height - 50),
      minWidth: Math.min(680, area.width),
      minHeight: Math.min(468, area.height),
      resizable: true,
      maximizable: true,
      minimizable: true,
      frame: false,
      transparent: true,
      show: false,
      title: "Wuwa Tappo · Studio & Collection",
      backgroundColor: "#00000000",
      autoHideMenuBar: true,
      webPreferences: {
        preload: options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        offscreen: options.selfTest,
      },
    });
    options.setStudio(studio);
    options.attachWindowInput(studio);
    studio.loadFile(options.rendererPath);
    studio.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        studio.show();
        studio.focus();
      }, 200);
    });
    studio.on("focus", () => setTimeout(keepPetOnTop, 0));
    studio.on("close", (event) => {
      if (options.isQuitting()) return;
      event.preventDefault();
      studio.hide();
    });
    secureWindow(studio);
  }

  return {
    placePet,
    applySettings,
    applySkipTaskbar,
    keepPetOnTop,
    updateMousePassthrough,
    fitStudio,
    resizeStudio,
    secureWindow,
    showStudio,
    clearStudioRestoreBounds,
  };
}
