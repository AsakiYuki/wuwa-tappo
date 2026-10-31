import type { PetAPI, PetSettings } from "../types";

interface SettingsPanelOptions {
  container: HTMLElement;
  api: PetAPI;
  toast(message: string): void;
  confirmReset(): boolean;
  version: string;
}

type SettingKey = keyof PetSettings;

const ranges = [
  { key: "opacity", title: "Pet Opacity", min: 0.3, max: 1, step: 0.05 },
  { key: "scale", title: "Pet Scale", min: 0.65, max: 1.5, step: 0.05 },
] as const;

const switches: Array<{
  key: SettingKey;
  title: string;
  description?: string;
}> = [
  { key: "autoStart", title: "Launch at Startup" },
  {
    key: "lockDrag",
    title: "Lock Pet Position",
    description: "Prevents moving the pet by dragging.",
  },
  {
    key: "hoverFade",
    title: "Hover on Fade",
    description: "Pet becomes semi-transparent when mouse hovers over it.",
  },
  {
    key: "showChest",
    title: "Always Show Chest",
    description: "Always show chest shortcut next to pet.",
  },
  { key: "showKeyboard", title: "Show Keyboard" },
  { key: "counterLeft", title: "Move Counter to Left" },
  { key: "alwaysOnTop", title: "Always On Top" },
  { key: "inputEnabled", title: "Keyboard & Mouse Reaction" },
  {
    key: "passthrough",
    title: "Mouse Passthrough",
    description: "Press Ctrl+Alt+P to toggle.",
  },
];

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function mountSettingsPanel({
  container,
  api,
  toast,
  confirmReset,
  version,
}: SettingsPanelOptions): (
  settings: PetSettings,
  monitorCount: number,
) => void {
  const addSwitch = (key: SettingKey, title: string, description?: string) => {
    const row = element("div", `setting-item${description ? " has-sub" : ""}`);
    const labelText = element("div");
    labelText.append(element("div", "setting-title", title));
    if (description)
      labelText.append(element("div", "setting-sub", description));

    const label = element("label", "setting-switch");
    const input = element("input");
    input.type = "checkbox";
    input.dataset.setting = key;
    input.setAttribute("aria-label", title);
    label.append(input, element("span", "setting-slider"));
    row.append(labelText, label);
    container.append(row);
  };

  switches
    .slice(0, 6)
    .forEach(({ key, title, description }) =>
      addSwitch(key, title, description),
    );

  for (const { key, title, min, max, step } of ranges) {
    const row = element("div", "setting-item");
    const content = element("div", "setting-content");
    const input = element("input", "setting-range");
    const value = element("span", "setting-value");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.dataset.setting = key;
    input.setAttribute("aria-label", title);
    value.id = `${key}Value`;
    content.append(input, value);
    row.append(element("div", "setting-title", title), content);
    container.append(row);
  }

  const counterLimitRow = element("div", "setting-item has-sub");
  const counterLimitLabel = element("div");
  counterLimitLabel.append(
    element("div", "setting-title", "Counter Limit"),
    element("div", "setting-sub", "Reset the counter after this value."),
  );
  const counterLimitInput = element("input", "setting-number");
  counterLimitInput.type = "number";
  counterLimitInput.min = "1";
  counterLimitInput.max = "9999";
  counterLimitInput.step = "1";
  counterLimitInput.dataset.setting = "counterLimit";
  counterLimitInput.setAttribute("aria-label", "Counter Limit");
  counterLimitRow.append(counterLimitLabel, counterLimitInput);
  container.append(counterLimitRow);

  const displayRow = element("div", "setting-item has-sub");
  const displayText = element("div");
  displayText.append(
    element("div", "setting-title", "Display Screen:"),
    element("div", "setting-sub", "Press F8 to cycle"),
  );
  displayText.firstElementChild!.id = "monitorLabel";
  const cycleButton = element("button", "setting-btn", "Cycle Screen");
  cycleButton.onclick = () => void api.command("settings", { monitor: 0 });
  displayRow.append(displayText, cycleButton);
  container.append(displayRow);

  switches
    .slice(6)
    .forEach(({ key, title, description }) =>
      addSwitch(key, title, description),
    );

  const versionRow = element("div", "setting-item");
  const versionButton = element("button", "setting-btn", "Version Info");
  versionButton.onclick = () =>
    toast("Local version · All assets built-in offline");
  versionRow.append(
    element("div", "setting-title", `Current Version ${version} · Offline`),
    versionButton,
  );
  container.append(versionRow);

  const dataRow = element("div", "setting-item has-sub");
  const dataDescription = element("div");
  dataDescription.append(
    element("div", "setting-title", "Collection Data"),
    element("div", "setting-sub", "Unlock every item or start over."),
  );
  const dataActions = element("div", "setting-content");
  const unlockButton = element("button", "setting-btn", "Unlock All");
  const resetButton = element("button", "setting-btn", "Reset");
  unlockButton.onclick = async () => {
    const result = await api.command("unlock-all");
    if (result.ok) toast("All characters, accessories and emotes unlocked");
  };
  resetButton.onclick = () => {
    if (confirmReset()) void api.command("reset-data");
  };
  dataActions.append(unlockButton, resetButton);
  dataRow.append(dataDescription, dataActions);
  container.append(dataRow);

  container.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.dataset.setting) return;
    const value =
      input.type === "checkbox" ? input.checked : Number(input.value);
    void api.command("settings", { [input.dataset.setting]: value });
  });

  return (settings, monitorCount) => {
    container
      .querySelectorAll<HTMLInputElement>("[data-setting]")
      .forEach((input) => {
        const key = input.dataset.setting as SettingKey;
        const value = settings[key];
        if (typeof value === "boolean") {
          input.checked = value;
          return;
        }
        if (typeof value !== "number") return;
        input.value = String(value);
        if (input.type === "range")
          input.style.setProperty(
            "--range-progress",
            `${((value - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100}%`,
          );
      });
    container.querySelector<HTMLElement>("#scaleValue")!.textContent =
      `${Math.round(settings.scale * 100)}%`;
    container.querySelector<HTMLElement>("#opacityValue")!.textContent =
      `${Math.round(settings.opacity * 100)}%`;
    container.querySelector<HTMLElement>("#monitorLabel")!.textContent =
      `Display Screen: ${settings.monitor + 1} / ${monitorCount}`;
    cycleButton.onclick = () =>
      void api.command("settings", {
        monitor: (settings.monitor + 1) % Math.max(1, monitorCount),
      });
  };
}
