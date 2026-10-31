import type { CatalogItem, PetState } from "../types";
import { byId, createElement, createImage } from "./dom";

interface PresetsPanelOptions {
  getState(): PetState;
  getItem(id: string): CatalogItem | undefined;
  command(name: string, argument?: unknown): Promise<{ ok: boolean }>;
  navigate(page: "collection"): void;
}

export function mountPresetsPanel({
  getState,
  getItem,
  command,
  navigate,
}: PresetsPanelOptions): () => void {
  function render() {
    const container = byId("presets");
    const { presets } = getState();
    container.replaceChildren();

    if (!presets.length) {
      container.append(createElement("div", "empty", "No presets saved"));
    }

    for (const preset of presets) {
      const character = getItem(preset.character);
      if (!character) continue;

      const card = createElement("article", "preset");
      card.append(
        createImage(character.thumbnail),
        createElement("h3", "", preset.name),
      );

      const actions = createElement("div", "actions");
      const equipButton = createElement("button", "common-btn", "Equip");
      const deleteButton = createElement("button", "common-btn", "Delete");

      equipButton.onclick = () => void command("preset-load", preset.id);
      deleteButton.onclick = () => {
        if (confirm(`Delete preset “${preset.name}”?`)) {
          void command("preset-delete", preset.id);
        }
      };

      actions.append(equipButton, deleteButton);
      card.append(actions);
      container.append(card);
    }
  }

  byId("savePreset").onclick = async () => {
    const nameInput = byId("presetName") as HTMLInputElement;
    const result = await command("preset-save", nameInput.value || "My Outfit");
    if (!result.ok) return;

    nameInput.value = "";
    navigate("collection");
  };

  return render;
}
