import type { CatalogItem, PetState, PetAPI } from "../types";
import { labels, typeNames } from "./constants";
import {
  getSynthesisGroups,
  type SynthesisGroup,
  type SynthesisMode,
} from "./collection";
import { byId, createElement, createImage, createToast } from "./dom";

interface SynthesisPanelOptions {
  api: PetAPI;
  getItems(): CatalogItem[];
  getState(): PetState;
  showResults(results: Array<{ id: string; fresh: boolean }>): void;
}

export function mountSynthesisPanel({
  api,
  getItems,
  getState,
  showResults,
}: SynthesisPanelOptions): () => void {
  const toast = createToast();
  let mode: SynthesisMode = "upgrade";
  let selectedGroup: SynthesisGroup | null = null;
  let working = false;

  const groups = () => getSynthesisGroups(getItems(), getState(), mode);
  const cost = () => (mode === "same" ? 5 : 10);

  function render() {
    const group = groups().find(
      (candidate) =>
        selectedGroup?.type === candidate.type &&
        selectedGroup.rarity === candidate.rarity,
    );
    const slots = byId("synthesisSlots");
    slots.replaceChildren();

    const selectedItems: CatalogItem[] = [];
    if (group) {
      for (const item of group.candidates) {
        const duplicates = Math.max(0, (getState().owned[item.id] ?? 0) - 1);
        const count = Math.min(cost() - selectedItems.length, duplicates);
        for (let index = 0; index < count; index++) selectedItems.push(item);
      }
    }

    for (let index = 0; index < cost(); index++) {
      const slot = createElement("button", "synthesis-item");
      const item = selectedItems[index];
      if (item && group) {
        const thumbnail = createElement(
          "div",
          `synthesis-thumb synthesis-thumb--${group.rarity}`,
        );
        thumbnail.append(createImage(item.thumbnail));
        slot.append(thumbnail);
      } else {
        slot.append(createElement("div", "synthesis-add"));
      }
      slot.onclick = openMaterials;
      slots.append(slot);
    }

    byId("synthesisTip").textContent =
      `Combine ${cost()} items of the same type and rarity to synthesize 1 random ` +
      `${mode === "same" ? "same-tier" : "higher-tier"} item.`;

    document
      .querySelectorAll<HTMLButtonElement>("[data-synth-count]")
      .forEach((button) => {
        button.disabled =
          !group || group.count < cost() * Number(button.dataset.synthCount);
      });

    byId("synthesisSelected").textContent = group
      ? `${typeNames[group.type]} · ${labels[group.rarity]} · Duplicates: ${group.count}`
      : "";
  }

  function openMaterials() {
    const container = byId("materialGroups");
    container.replaceChildren();
    for (const group of groups()) {
      const button = createElement("button", "material-group");
      button.append(
        createElement(
          "strong",
          "",
          `${typeNames[group.type]} · ${labels[group.rarity]}`,
        ),
        createElement("p", "", `${group.count} duplicates`),
      );
      button.disabled = group.count < cost();
      button.onclick = () => {
        selectedGroup = group;
        (byId("materialPicker") as HTMLDialogElement).close();
        render();
      };
      container.append(button);
    }
    const dialog = byId("materialPicker") as HTMLDialogElement;
    if (!dialog.open) dialog.showModal();
  }

  byId("closeMaterials").onclick = () =>
    (byId("materialPicker") as HTMLDialogElement).close();
  byId("autoSelect").onclick = () => {
    selectedGroup = groups().find((group) => group.count >= cost()) ?? null;
    if (!selectedGroup) toast("Not enough duplicate items for synthesis");
    render();
  };

  document
    .querySelectorAll<HTMLButtonElement>("[data-synth-mode]")
    .forEach((button) => {
      button.onclick = () => {
        mode = button.dataset.synthMode as SynthesisMode;
        selectedGroup = null;
        document
          .querySelectorAll("[data-synth-mode]")
          .forEach((option) =>
            option.classList.toggle("selected", option === button),
          );
        render();
      };
    });

  document
    .querySelectorAll<HTMLButtonElement>("[data-synth-count]")
    .forEach((button) => {
      button.onclick = async () => {
        if (working || !selectedGroup) return;
        working = true;
        try {
          const result = await api.command("synthesize", {
            n: Number(button.dataset.synthCount),
            rarity: selectedGroup.rarity,
            type: selectedGroup.type,
            mode,
          });
          if (result.ok)
            showResults(result.result as Array<{ id: string; fresh: boolean }>);
          else if (result.error) toast(result.error);
        } finally {
          working = false;
        }
      };
    });

  return render;
}
