import { getItemName } from "../names";
import type { CatalogItem, PetState } from "../types";
import { assetPath } from "../types";
import { byId, createElement, createImage } from "./dom";

interface OutfitPreviewOptions {
  getState(): PetState;
  getItem(id: string): CatalogItem | undefined;
  getReplacementSlot(): number | null;
  chooseEmoteSlot(slot: number): void;
  command(name: string, argument?: unknown): Promise<unknown>;
  navigateToPresets(): void;
}

export function mountOutfitPreview(options: OutfitPreviewOptions): () => void {
  function renderLayeredPreset(characterId: string, accessoryId: string) {
    const character = options.getItem(characterId);
    if (!character) return createElement("div", "preset-img");

    const preview = createElement("div", "preset-img");
    preview.append(
      createImage(character.layers.head1),
      createImage(character.layers.body1),
    );

    const accessory = accessoryId ? options.getItem(accessoryId) : undefined;
    if (accessory) {
      const image = createImage(accessory.image);
      image.style.transform = `translate(${(character.offsetX || 0) * 0.5}px, ${(character.offsetY || 0) * 0.5}px)`;
      preview.append(image);
    }
    return preview;
  }

  return function render() {
    const state = options.getState();
    const character = options.getItem(state.character);
    const accessory = state.accessory
      ? options.getItem(state.accessory)
      : undefined;
    if (!character) return;

    (byId("heroHead") as HTMLImageElement).src = assetPath(
      character.layers.head1,
    );
    (byId("heroBody") as HTMLImageElement).src = assetPath(
      character.layers.body1,
    );

    const accessoryImage = byId("heroAccessory") as HTMLImageElement;
    accessoryImage.hidden = !accessory;
    if (accessory) {
      accessoryImage.src = assetPath(accessory.image);
      accessoryImage.style.transform = `translate(${(character.offsetX || 0) * 1.2}px, ${(character.offsetY || 0) * 1.2}px)`;
    }

    const emoteContainer = byId("previewEmotes");
    emoteContainer.replaceChildren();
    for (let slot = 0; slot < 5; slot++) {
      const id = state.emotes[slot];
      const emote = id ? options.getItem(id) : undefined;
      const button = createElement(
        "button",
        `preset-preview-emote preset-preview-emote${slot + 1}`,
      );
      const imageFrame = createElement("div", "preset-preview-emote-img");

      if (emote) {
        imageFrame.append(createImage(emote.image));
        button.title = `Replace emote ${slot + 1} · ${getItemName(emote)}`;
        button.oncontextmenu = (event) => {
          event.preventDefault();
          void options.command("emote", id);
        };
      } else {
        button.title = `Equip emote ${slot + 1}`;
      }
      button.onclick = () => options.chooseEmoteSlot(slot);

      const isReplacing = options.getReplacementSlot() === slot;
      button.classList.toggle("replacing-emote", isReplacing);
      button.append(
        imageFrame,
        createElement(
          "span",
          "emote-change-label",
          isReplacing ? "Selecting" : "Change",
        ),
      );
      emoteContainer.append(button);
    }

    const presetContainer = byId("miniPresets");
    presetContainer.replaceChildren();
    for (
      let index = 0;
      index < Math.max(6, state.presets.length + 1);
      index++
    ) {
      const preset = state.presets[index];
      const button = createElement(
        "button",
        `preset-item${preset ? "" : " preset-item--add"}`,
      );
      if (preset) {
        button.append(renderLayeredPreset(preset.character, preset.accessory));
        button.title = preset.name;
        button.onclick = () => void options.command("preset-load", preset.id);
        button.oncontextmenu = (event) => {
          event.preventDefault();
          options.navigateToPresets();
        };
      } else {
        button.title = "Add Preset";
        button.onclick = options.navigateToPresets;
      }
      presetContainer.append(button);
    }
  };
}
