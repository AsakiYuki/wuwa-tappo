const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  session,
  shell,
} = require("electron");
if (process.platform === "linux") {
  try {
    app.commandLine.appendSwitch("enable-features", "WaylandWindowDecorations");
  } catch {}
}
const fs = require("fs"),
  path = require("path");
const core = require("./core.cjs"),
  storage = require("./storage.cjs"),
  { items } = require("./catalog.json");
const QA = process.argv.includes("--qa"),
  PORTABLE = app.isPackaged ? path.dirname(process.execPath) : __dirname;
const SELFTEST =
  QA &&
  process.argv.includes("--selftest") &&
  !process.argv.includes("--snapshot") &&
  !process.argv.includes("--interactive-test");
const dataDir = QA
  ? path.join(
      process.env.WUWA_QA_OUTPUT || path.join(__dirname, ".."),
      "qa-data-" + process.pid,
    )
  : path.join(app.getPath("appData"), "WuwaTappoOffline");
fs.mkdirSync(dataDir, { recursive: true });
app.setName("Wuwa Tappo Offline");
app.setPath("userData", path.join(dataDir, "runtime"));
const primaryInstance = app.requestSingleInstanceLock();
const savePath = path.join(dataDir, "collection.json"),
  profile =
    primaryInstance && !QA
      ? storage.initProfile({
          dataDir,
          portableDir: PORTABLE,
          searchRoots: [app.getPath("downloads")],
          items,
        })
      : { state: core.initial(items), warning: "" };
let state = profile.state,
  saveWarning = profile.warning;
if (!QA) {
  for (const it of items) if (!state.owned[it.id]) state.owned[it.id] = 1;
}
let pet,
  studio,
  tray,
  hook,
  hookActive = false,
  evdevDevices = [],
  evdevTimer,
  hookStatus = "Connecting keyboard...",
  saveTimer,
  quitting = false,
  pressed = new Set(),
  inputSerial = 0,
  topTimer,
  pointerTimer,
  lastIgnore;
const writeState = storage.createWriter(savePath);
async function save() {
  try {
    await writeState(state);
    return true;
  } catch (e) {
    saveWarning = "Failed to save collection, please check folder permissions";
    status();
    return false;
  }
}
function laterSave() {
  if (!saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null;
      save();
    }, 3000);
}
function windows() {
  return [pet, studio].filter((w) => w && !w.isDestroyed());
}
function broadcast() {
  for (const w of windows()) w.webContents.send("state", state);
}
function status() {
  for (const w of windows())
    w.webContents.send("status", { hook: hookStatus, warning: saveWarning });
}
function display() {
  const ds = screen.getAllDisplays();
  return ds[state.settings.monitor] || screen.getPrimaryDisplay();
}
function place(resetToCorner = false) {
  if (!pet) return;
  const a = display().workArea;
  const w = Math.round(320 * state.settings.scale),
    h = Math.round(350 * state.settings.scale);
  if (
    !resetToCorner &&
    state.settings.petPosition &&
    Number.isFinite(state.settings.petPosition.x) &&
    Number.isFinite(state.settings.petPosition.y)
  ) {
    const px = state.settings.petPosition.x,
      py = state.settings.petPosition.y,
      wa = screen.getDisplayMatching({
        x: px,
        y: py,
        width: w,
        height: h,
      }).workArea,
      nx = Math.round(Math.max(wa.x, Math.min(px, wa.x + wa.width - w))),
      ny = Math.round(Math.max(wa.y, Math.min(py, wa.y + wa.height - h)));
    pet.setBounds({ x: nx, y: ny, width: w, height: h });
    state.settings.petPosition = { x: nx, y: ny };
    return;
  }
  const defaultX = a.x + a.width - w - 24,
    defaultY = a.y + a.height - h - 12;
  pet.setBounds({ x: defaultX, y: defaultY, width: w, height: h });
  state.settings.petPosition = { x: defaultX, y: defaultY };
}
function applyKWinRules() {
  if (process.platform !== "linux") return;
  try {
    const kwinFile = path.join(require("os").homedir(), ".config/kwinrulesrc");
    if (fs.existsSync(kwinFile)) {
      let content = fs.readFileSync(kwinFile, "utf8");
      if (!content.includes("[wuwa-tappo-pet]")) {
        content = content.replace(/(rules=[^\n]+)/, "$1,wuwa-tappo-pet");
        content = content.replace(
          /(count=)(\d+)/,
          (_, p1, p2) => p1 + (Number(p2) + 1),
        );
        const rule =
          "\n[wuwa-tappo-pet]\nDescription=Wuwa Tappo Pet\nabove=" +
          state.settings.alwaysOnTop +
          "\naboverule=2\nnoborder=true\nnoborderrule=2\nskiptaskbar=true\nskiptaskbarrule=2\nskippager=true\nskippagerrule=2\ntitle=Wuwa Tappo · Desktop Pet\ntitlematch=1\ntypes=1\n";
        fs.writeFileSync(kwinFile, content + rule);
        try {
          require("child_process").execSync(
            "qdbus org.kde.KWin /KWin reconfigure",
          );
        } catch {}
      } else {
        const updated = content.replace(
          /(\[wuwa-tappo-pet\][\s\S]*?\nabove=)(true|false)/,
          (_, prefix) => prefix + state.settings.alwaysOnTop,
        );
        if (updated !== content) {
          fs.writeFileSync(kwinFile, updated);
          try {
            require("child_process").execSync(
              "qdbus org.kde.KWin /KWin reconfigure",
            );
          } catch {}
        }
      }
    }
  } catch {}
}
function applySkipTaskbar() {
  if (!pet || pet.isDestroyed()) return;
  if (process.platform !== "linux") {
    pet.setSkipTaskbar(true);
    return;
  }
  applyKWinRules();
  const x11 =
    Boolean(process.env.DISPLAY) &&
    (process.env.ELECTRON_OZONE_PLATFORM_HINT === "x11" ||
      process.argv.includes("--ozone-platform=x11"));
  if (!x11) return;
  try {
    const xid = "0x" + pet.getNativeWindowHandle().readUInt32LE(0).toString(16);
    if (xid === "0x0") return;
    require("child_process").execFile(
      "wmctrl",
      ["-ir", xid, "-b", "add,skip_taskbar,skip_pager"],
      { timeout: 1500 },
      () => {},
    );
  } catch {}
}
function keepPetOnTop() {
  if (
    !pet ||
    pet.isDestroyed() ||
    !pet.isVisible() ||
    !state.settings.alwaysOnTop
  )
    return;
  pet.setAlwaysOnTop(true, "screen-saver", 1);
  pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  applySkipTaskbar();
  pet.moveTop();
}
function pointerMode() {
  if (!pet || pet.isDestroyed()) return;
  const ignore = Boolean(state.settings.passthrough);
  if (ignore !== lastIgnore) {
    pet.setIgnoreMouseEvents(ignore, { forward: true });
    lastIgnore = ignore;
  }
}
function applySettings() {
  if (!pet) return;
  if (process.platform === "linux") applyKWinRules();
  pet.setAlwaysOnTop(
    state.settings.alwaysOnTop,
    state.settings.alwaysOnTop ? "screen-saver" : "normal",
    1,
  );
  pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (state.settings.alwaysOnTop) keepPetOnTop();
  pet.setOpacity(state.settings.opacity);
  pointerMode();
  if (tray) tray.setContextMenu(menu());
}
let studioRestoreBounds = null;
function fitStudio(bounds) {
  const a = screen.getDisplayMatching(bounds).workArea,
    width = Math.round(
      Math.max(Math.min(680, a.width), Math.min(bounds.width, a.width)),
    ),
    height = Math.round(
      Math.max(Math.min(468, a.height), Math.min(bounds.height, a.height)),
    );
  return {
    x: Math.round(Math.max(a.x, Math.min(bounds.x, a.x + a.width - width))),
    y: Math.round(Math.max(a.y, Math.min(bounds.y, a.y + a.height - height))),
    width,
    height,
  };
}
function studioWindow(action) {
  if (!studio || studio.isDestroyed()) return;
  if (action === "minimize") {
    studio.minimize();
    return;
  }
  const b = studio.getBounds();
  if (action === "maximize") {
    if (studioRestoreBounds) {
      studio.setBounds(fitStudio(studioRestoreBounds));
      studioRestoreBounds = null;
    } else {
      studioRestoreBounds = b;
      studio.setBounds(screen.getDisplayMatching(b).workArea);
    }
    return;
  }
  if (action === "smaller" || action === "larger") {
    const factor = action === "larger" ? 1.1 : 1 / 1.1;
    studioRestoreBounds = null;
    studio.setBounds(
      fitStudio({ ...b, width: b.width * factor, height: b.height * factor }),
    );
  }
}

function showStudio() {
  if (studio && !studio.isDestroyed()) {
    if (studio.isMinimized()) studio.restore();
    studio.setBounds(fitStudio(studio.getBounds()));
    studio.show();
    studio.focus();
    return;
  }
  const a = screen.getPrimaryDisplay().workArea;
  studio = new BrowserWindow({
    width: Math.min(1100, a.width - 50),
    height: Math.min(756, a.height - 50),
    minWidth: Math.min(680, a.width),
    minHeight: Math.min(468, a.height),
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
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: SELFTEST,
    },
  });
  attachWindowInput(studio);
  studio.loadFile(path.join(__dirname, "renderer-build", "studio.html"));
  studio.webContents.once("did-finish-load", () =>
    setTimeout(() => {
      studio.show();
      studio.focus();
    }, 200),
  );
  studio.on("focus", () => setTimeout(keepPetOnTop, 0));
  studio.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      studio.hide();
    }
  });
  secure(studio);
}
function secure(w) {
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  w.webContents.on("will-navigate", (e) => e.preventDefault());
}
function menu() {
  const items = [
    { label: "Collection & Outfits", click: showStudio },
    {
      label: "Show Pet / Reset to Screen Corner",
      click: () => {
        pet.show();
        place(true);
        save();
      },
    },
    {
      label: "Mouse Passthrough (Ctrl+Alt+P to toggle)",
      type: "checkbox",
      checked: state.settings.passthrough,
      click: () => {
        state.settings.passthrough = !state.settings.passthrough;
        applySettings();
        save();
        broadcast();
      },
    },
    {
      label: "Enable Keyboard & Mouse Input",
      type: "checkbox",
      checked: state.settings.inputEnabled,
      click: () => {
        state.settings.inputEnabled = !state.settings.inputEnabled;
        applySettings();
        save();
        broadcast();
      },
    },
  ];
  if (process.platform === "linux" && !hookStatus.includes("connected")) {
    items.push({
      label: "⚡ Fix Input Permissions (Linux)",
      click: () => {
        const { exec } = require("child_process");
        exec("pkexec setfacl -m u:$USER:r /dev/input/event*", () => {
          startHook();
          applySettings();
        });
      },
    });
  }
  items.push(
    { type: "separator" },
    { label: "Exit Wuwa Tappo", click: () => app.quit() },
  );
  return Menu.buildFromTemplate(items);
}
function input(key, down, side, newPhysicalPress = false) {
  if (!state.settings.inputEnabled) return;
  if (down && pressed.has(key) && !newPhysicalPress) return;
  if (down) {
    pressed.add(key);
    const emote = core.registerTap(state, items);
    if (state.count === 0) {
      save();
      if (emote) pet?.webContents.send("emote", emote);
    } else laterSave();
  } else pressed.delete(key);
  const event = { key, down, side, count: state.count, serial: ++inputSerial };
  if (pet && !pet.isDestroyed()) pet.webContents.send("input", event);
}

const LINUX_KEYMAP = {
  1: "Escape",
  2: "1",
  3: "2",
  4: "3",
  5: "4",
  6: "5",
  7: "6",
  8: "7",
  9: "8",
  10: "9",
  11: "0",
  12: "Minus",
  13: "Equal",
  14: "Backspace",
  15: "Tab",
  16: "Q",
  17: "W",
  18: "E",
  19: "R",
  20: "T",
  21: "Y",
  22: "U",
  23: "I",
  24: "O",
  25: "P",
  26: "BracketLeft",
  27: "BracketRight",
  28: "Enter",
  29: "Ctrl",
  30: "A",
  31: "S",
  32: "D",
  33: "F",
  34: "G",
  35: "H",
  36: "J",
  37: "K",
  38: "L",
  39: "Semicolon",
  40: "Quote",
  41: "Backquote",
  42: "Shift",
  43: "Backslash",
  44: "Z",
  45: "X",
  46: "C",
  47: "V",
  48: "B",
  49: "N",
  50: "M",
  51: "Comma",
  52: "Period",
  53: "Slash",
  54: "ShiftRight",
  56: "Alt",
  57: "Space",
  58: "CapsLock",
  59: "F1",
  60: "F2",
  61: "F3",
  62: "F4",
  63: "F5",
  64: "F6",
  65: "F7",
  66: "F8",
  67: "F9",
  68: "F10",
  87: "F11",
  88: "F12",
  97: "CtrlRight",
  100: "AltRight",
  102: "Home",
  103: "ArrowUp",
  104: "PageUp",
  105: "ArrowLeft",
  106: "ArrowRight",
  107: "End",
  108: "ArrowDown",
  109: "PageDown",
  110: "Insert",
  111: "Delete",
  125: "Meta",
  126: "MetaRight",
};
const LINUX_MOUSEMAP = {
  272: "MouseLeft",
  273: "MouseRight",
  274: "MouseMiddle",
};

function readEvdev(device, chunk) {
  const buf = Buffer.concat([device.leftover, chunk]),
    eventSize = 24;
  let offset = 0;
  while (offset + eventSize <= buf.length) {
    const type = buf.readUInt16LE(offset + 16),
      code = buf.readUInt16LE(offset + 18),
      value = buf.readInt32LE(offset + 20);
    offset += eventSize;
    if (type === 0 && code === 3) {
      pressed.clear();
      continue;
    }
    if (type !== 1) continue;
    const mouse =
      LINUX_MOUSEMAP[code] ||
      (code >= 272 && code <= 287
        ? code === 273
          ? "MouseRight"
          : "MouseLeft"
        : null);
    const key = LINUX_KEYMAP[code] || "Key" + code;
    if (mouse && (value === 1 || value === 0))
      input(mouse, value === 1, mouse === "MouseLeft" ? "left" : "right");
    else if (code < 256 && (value === 0 || value === 1)) {
      const down = value === 1;
      input(
        key,
        down,
        /^[QWERTASDFGZXCVB12345]$|Left|^Ctrl$|^Shift$|^Alt$|Tab|CapsLock/.test(
          key,
        )
          ? "left"
          : "right",
        down,
      );
      if (
        down &&
        pressed.has("Ctrl") &&
        pressed.has("Alt") &&
        ["1", "2", "3", "4", "5"].includes(key)
      ) {
        const id = state.emotes[Number(key) - 1];
        if (id) pet?.webContents.send("emote", id);
      }
    }
  }
  device.leftover = buf.subarray(offset);
}
function startEvdev() {
  if (process.platform !== "linux") return false;
  if (evdevTimer) clearInterval(evdevTimer);
  evdevTimer = null;
  pressed.clear();
  for (const device of evdevDevices) {
    try {
      fs.closeSync(device.fd);
    } catch {}
  }
  evdevDevices = [];
  try {
    const devices = fs
      .readFileSync("/proc/bus/input/devices", "utf8")
      .split("\n\n");
    for (const d of devices) {
      if (!/Handlers=.*(kbd|mouse)/.test(d)) continue;
      const m = d.match(/event(\d+)/);
      if (!m) continue;
      const devPath = "/dev/input/event" + m[1];
      try {
        fs.accessSync(devPath, fs.constants.R_OK);
        const fd = fs.openSync(
          devPath,
          fs.constants.O_RDONLY | fs.constants.O_NONBLOCK,
        );
        evdevDevices.push({
          fd,
          isKeyboard: /Handlers=.*\bkbd\b/.test(d),
          buffer: Buffer.alloc(4096),
          leftover: Buffer.alloc(0),
        });
      } catch {}
    }
  } catch {}
  if (evdevDevices.length) {
    evdevTimer = setInterval(() => {
      for (const device of [...evdevDevices]) {
        try {
          for (;;) {
            const size = fs.readSync(
              device.fd,
              device.buffer,
              0,
              device.buffer.length,
              null,
            );
            if (!size) break;
            readEvdev(device, device.buffer.subarray(0, size));
          }
        } catch (e) {
          if (e.code === "EAGAIN" || e.code === "EWOULDBLOCK") continue;
          evdevDevices = evdevDevices.filter((d) => d !== device);
          try {
            fs.closeSync(device.fd);
          } catch {}
          if (device.isKeyboard) pressed.clear();
        }
      }
      if (!evdevDevices.length) {
        clearInterval(evdevTimer);
        evdevTimer = null;
      }
    }, 8);
  }
  return evdevDevices.some((device) => device.isKeyboard);
}

function attachWindowInput(w) {
  if (!w || w.isDestroyed()) return;
  w.webContents.on("before-input-event", (e, ev) => {
    if (hookActive || evdevDevices.some((device) => device.isKeyboard)) return;
    if (ev.type === "keyDown" || ev.type === "keyUp") {
      const down = ev.type === "keyDown";
      let k = ev.key.length === 1 ? ev.key.toUpperCase() : ev.key;
      if (k === " ") k = "Space";
      else if (k === "Control") k = "Ctrl";
      else if (k === "Shift") k = "Shift";
      else if (k === "Alt") k = "Alt";
      else if (k === "CapsLock") k = "CapsLock";
      else if (k === "Backspace") k = "Backspace";
      else if (k === "Enter") k = "Enter";
      else if (k === "Tab") k = "Tab";
      else if (k === "Meta") k = "Meta";
      else if (k === ";") k = "Semicolon";
      else if (k === ",") k = "Comma";
      else if (k === ".") k = "Period";
      else if (k === "/") k = "Slash";
      input(
        k,
        down,
        /^[QWERTASDFGZXCVB12345]$|Left|^Ctrl$|^Shift$|^Alt$|Tab|CapsLock/.test(
          k,
        )
          ? "left"
          : "right",
      );
      if (
        down &&
        ev.control &&
        ev.alt &&
        ["1", "2", "3", "4", "5"].includes(k)
      ) {
        const id = state.emotes[Number(k) - 1];
        if (id) pet?.webContents.send("emote", id);
      }
    }
  });
}

function startHook() {
  const evdevOk = startEvdev();
  let uiohookOk = false;
  if (!process.env.WAYLAND_DISPLAY) {
    try {
      const { uIOhook, UiohookKey } = require("uiohook-napi");
      hook = uIOhook;
      const names = new Map();
      for (const [k, v] of Object.entries(UiohookKey))
        if (!names.has(v)) names.set(v, k);
      hook.on("keydown", (e) => {
        if (QA && process.argv.includes("--selftest")) return;
        const key = names.get(e.keycode) || "Other";
        input(
          key,
          true,
          /^[QWERTASDFGZXCVB12345]$|Left|^Ctrl$|^Shift$|^Alt$|Tab|CapsLock/.test(
            key,
          )
            ? "left"
            : "right",
        );
        if (e.ctrlKey && e.altKey && ["1", "2", "3", "4", "5"].includes(key)) {
          const id = state.emotes[Number(key) - 1];
          if (id) pet?.webContents.send("emote", id);
        }
      });
      hook.on("keyup", (e) => {
        if (QA && process.argv.includes("--selftest")) return;
        input(names.get(e.keycode) || "Other", false);
      });
      hook.on("mousedown", (e) => {
        if (QA && process.argv.includes("--selftest")) return;
        input(
          e.button === 1
            ? "MouseLeft"
            : e.button === 2
              ? "MouseRight"
              : "MouseMiddle",
          true,
          e.button === 1 ? "left" : "right",
        );
      });
      hook.on("mouseup", (e) => {
        if (QA && process.argv.includes("--selftest")) return;
        input(
          e.button === 1
            ? "MouseLeft"
            : e.button === 2
              ? "MouseRight"
              : "MouseMiddle",
          false,
        );
      });
      hook.start();
      hookActive = true;
      uiohookOk = true;
    } catch (e) {
      fs.appendFileSync(path.join(dataDir, "errors.log"), String(e) + "\n");
    }
  }
  if (evdevOk) hookStatus = "Global input connected (evdev)";
  else if (uiohookOk) hookStatus = "Global input connected (uiohook)";
  else
    hookStatus =
      "Wayland: Input permission required (run ./fix-permissions.sh)";
  status();
}
ipcMain.handle("init", () => ({
  state,
  items,
  filters: require("./catalog.json").filters,
  status: { hook: hookStatus, warning: saveWarning },
  monitors: screen
    .getAllDisplays()
    .map((d, i) => ({
      id: i,
      label: `Screen ${i + 1} · ${d.size.width}×${d.size.height}`,
    })),
}));
ipcMain.handle("command", async (_, name, arg) => {
  try {
    let result = null;
    switch (name) {
      case "open":
        showStudio();
        if (arg) {
          if (studio.webContents.isLoading())
            studio.webContents.once("did-finish-load", () =>
              setTimeout(() => studio.webContents.send("page", arg), 300),
            );
          else studio.webContents.send("page", arg);
        }
        return { ok: true };
      case "hide":
        studio?.hide();
        return { ok: true };
      case "draw":
        result = core.draw(state, items, arg);
        break;
      case "synthesize":
        result = core.synthesize(
          state,
          items,
          arg.n,
          arg.rarity,
          Math.random,
          arg,
        );
        break;
      case "equip":
        core.equip(state, items, arg);
        break;
      case "emote-replace":
        core.replaceEmote(state, items, arg.id, arg.slot);
        break;
      case "window":
        studioWindow(arg);
        return { ok: true };
      case "favorite":
        if (!items.some((x) => x.id === arg))
          throw Error("Item does not exist");
        state.favorites = state.favorites.includes(arg)
          ? state.favorites.filter((x) => x !== arg)
          : [...state.favorites, arg];
        break;
      case "preset-save": {
        const label = String(arg || "My Outfit")
          .trim()
          .slice(0, 24);
        if (state.presets.length >= 12)
          throw Error("Maximum 12 presets allowed");
        state.presets.push({
          id: Date.now().toString(36),
          name: label,
          character: state.character,
          accessory: state.accessory,
          emotes: [...state.emotes],
        });
        break;
      }
      case "preset-load": {
        const p = state.presets.find((x) => x.id === arg);
        if (!p) throw Error("Preset does not exist");
        state.character = p.character;
        state.accessory = p.accessory;
        state.emotes = [...p.emotes];
        break;
      }
      case "preset-delete":
        state.presets = state.presets.filter((x) => x.id !== arg);
        break;
      case "emote":
        if (
          !state.owned[arg] ||
          !items.some((x) => x.id === arg && x.type === "emote")
        )
          throw Error("Emote not owned");
        pet.webContents.send("emote", arg);
        return { ok: true };
      case "unlock-all":
        for (const item of items)
          state.owned[item.id] = Math.max(1, state.owned[item.id] || 0);
        break;
      case "reset-data":
        state = core.initial(items);
        pressed.clear();
        if (app.isPackaged)
          app.setLoginItemSettings({
            openAtLogin: false,
            path: process.execPath,
            args: [],
          });
        applySettings();
        place(true);
        break;
      case "settings": {
        pressed.clear();
        const old = state.settings;
        const next = core.settings({ ...old, ...arg });
        if (next.autoStart !== old.autoStart) {
          if (!app.isPackaged && next.autoStart)
            throw Error("Please enable auto-start from packaged build");
          app.setLoginItemSettings({
            openAtLogin: next.autoStart,
            path: process.execPath,
            args: [],
          });
        }
        state.settings = next;
        applySettings();
        if (next.scale !== old.scale || next.monitor !== old.monitor) place();
        break;
      }
      case "recenter":
        place(true);
        await save();
        pet.show();
        return { ok: true };
      case "tap":
        if (!hookStatus.includes("connected")) {
          input("MouseLeft", true, "left");
          input("MouseLeft", false);
        }
        return { ok: true };
      case "folder":
        await shell.openPath(dataDir);
        return { ok: true };
      case "quit":
        app.quit();
        return { ok: true };
      default:
        throw Error("Unknown command");
    }
    const saved = await save();
    broadcast();
    return { ok: true, result, warning: saved ? "" : saveWarning };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.on("move", (_, dx, dy) => {
  if (
    !pet ||
    pet.isDestroyed() ||
    state.settings.passthrough ||
    state.settings.lockDrag ||
    !Number.isFinite(dx) ||
    !Number.isFinite(dy)
  )
    return;
  const [x, y] = pet.getPosition();
  const a = screen.getDisplayMatching(pet.getBounds()).workArea;
  const b = pet.getBounds();
  const nx = Math.round(
    Math.max(a.x, Math.min(a.x + a.width - b.width, x + dx)),
  );
  const ny = Math.round(
    Math.max(a.y, Math.min(a.y + a.height - b.height, y + dy)),
  );
  pet.setPosition(nx, ny);
  state.settings.petPosition = { x: nx, y: ny };
  laterSave();
});
ipcMain.on("resize-studio", (event, edge, dx, dy) => {
  if (
    !studio ||
    event.sender !== studio.webContents ||
    !["n", "s", "e", "w", "ne", "nw", "se", "sw"].includes(edge) ||
    !Number.isFinite(dx) ||
    !Number.isFinite(dy)
  )
    return;
  studioRestoreBounds = null;
  const b = studio.getBounds();
  if (edge.includes("e")) b.width += dx;
  if (edge.includes("s")) b.height += dy;
  if (edge.includes("w")) {
    b.x += dx;
    b.width -= dx;
  }
  if (edge.includes("n")) {
    b.y += dy;
    b.height -= dy;
  }
  studio.setBounds(fitStudio(b));
});
if (!primaryInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    pet?.show();
    showStudio();
  });
  app.whenReady().then(async () => {
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
      (details, callback) => callback({ cancel: true }),
    );
    session.defaultSession.setPermissionRequestHandler((_, __, callback) =>
      callback(false),
    );
    pet = new BrowserWindow({
      width: 320,
      height: 350,
      transparent: true,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: state.settings.alwaysOnTop,
      type: process.platform === "linux" ? "dock" : "normal",
      title: "Wuwa Tappo · Desktop Pet",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        offscreen: SELFTEST,
        backgroundThrottling: false,
      },
    });
    attachWindowInput(pet);
    secure(pet);
    pet.loadFile(path.join(__dirname, "renderer-build", "pet.html"));
    pet.webContents.once("did-finish-load", () =>
      setTimeout(() => {
        applySkipTaskbar();
        pet.showInactive();
      }, 300),
    );
    pet.on("closed", () => {
      pet = null;
    });
    place();
    applySettings();
    for (const event of ["show", "restore", "blur"])
      pet.on(event, () => {
        applySkipTaskbar();
        setTimeout(keepPetOnTop, 0);
      });
    topTimer = setInterval(keepPetOnTop, 3000);
    pointerTimer = setInterval(pointerMode, 80);
    const icon = nativeImage
      .createFromPath(
        path.join(
          __dirname,
          items.find((x) => x.starter && x.type === "character").thumbnail,
        ),
      )
      .resize({ width: 24, height: 24 });
    tray = new Tray(icon);
    tray.setToolTip("Wuwa Tappo · Desktop Companion");
    tray.setContextMenu(menu());
    tray.on("double-click", showStudio);
    globalShortcut.register("CommandOrControl+Alt+P", () => {
      state.settings.passthrough = !state.settings.passthrough;
      applySettings();
      save();
      broadcast();
    });
    globalShortcut.register("F8", () => {
      state.settings.monitor =
        (state.settings.monitor + 1) % screen.getAllDisplays().length;
      place();
      save();
      broadcast();
    });
    screen.on("display-removed", () => place());
    screen.on("display-metrics-changed", () => place());
    startHook();
    save();
    if (
      QA ||
      process.argv.includes("--studio") ||
      (state.draws === 0 && state.presets.length === 0)
    )
      showStudio();
    if (SELFTEST) {
      for (const w of [pet, studio]) {
        w.hide();
        w.show = () => {};
        w.showInactive = () => {};
        w.focus = () => {};
      }
    }
    if (QA) {
      global.__QA = {
        state: () => state,
        pet: () => pet,
        studio: () => studio,
        hook: () => hookStatus,
        input,
      };
      if (process.argv.includes("--selftest"))
        require("./qa.cjs")({
          app,
          pet,
          studio,
          items,
          getState: () => state,
          save,
          dataDir,
          input,
        });
    }
  });
  app.on("before-quit", (e) => {
    if (quitting) return;
    e.preventDefault();
    quitting = true;
    clearTimeout(saveTimer);
    clearInterval(topTimer);
    clearInterval(pointerTimer);
    if (evdevTimer) clearInterval(evdevTimer);
    for (const device of evdevDevices) {
      try {
        fs.closeSync(device.fd);
      } catch {}
    }
    evdevDevices = [];
    try {
      hook?.stop();
    } catch {}
    globalShortcut.unregisterAll();
    save().finally(() => app.quit());
  });
  app.on("window-all-closed", () => app.quit());
}
