import { getItemName } from "../names";
import type { CatalogItem } from "../types";
import { labels } from "./constants";
import { byId, createElement } from "./dom";

interface ResultEntry {
  id: string;
  fresh: boolean;
}

interface ResultsPanelOptions {
  getItem(id: string): CatalogItem | undefined;
  createCard(item: CatalogItem, interactive: boolean): HTMLElement;
  command(
    name: string,
    argument?: unknown,
  ): Promise<{
    ok: boolean;
    result?: unknown;
  }>;
  toast(message: string): void;
}

export function mountResultsPanel(options: ResultsPanelOptions) {
  let lastDraw = 10;
  let drawing = false;

  function showResults(results: ResultEntry[], source: "draw" | "synthesis") {
    byId("resultTitle").textContent =
      source === "draw" ? "Items Obtained" : "Synthesis Successful";
    const grid = byId("resultGrid");
    grid.replaceChildren();
    grid.classList.toggle("single", results.length === 1);

    for (const [index, result] of results.entries()) {
      const item = options.getItem(result.id);
      if (!item) continue;

      const card = createElement("article", "result-card");
      card.style.animationDelay = `${index * 0.04}s`;
      card.append(
        options.createCard(item, false),
        createElement("p", "result-quality", labels[item.rarity]),
      );
      if (result.fresh) card.append(createElement("span", "new", "NEW"));

      if (item.type !== "emote") {
        const equip = createElement("button", "common-btn", "Equip");
        equip.onclick = async () => {
          if ((await options.command("equip", item.id)).ok) {
            options.toast(`Equipped ${getItemName(item)}`);
          }
        };
        card.append(equip);
      }
      grid.append(card);
    }

    const drawAgain = byId("drawAgain") as HTMLButtonElement;
    drawAgain.hidden = source !== "draw";
    drawAgain.textContent =
      lastDraw === 10 ? "Draw 10 Again ∞" : "Draw 1 Again ∞";

    const dialog = byId("results") as HTMLDialogElement;
    if (!dialog.open) dialog.showModal();
  }

  async function draw(count: number) {
    if (drawing) return;
    drawing = true;
    lastDraw = count;
    try {
      const response = await options.command("draw", count);
      if (response.ok) showResults(response.result as ResultEntry[], "draw");
    } finally {
      drawing = false;
    }
  }

  document
    .querySelectorAll<HTMLButtonElement>("[data-draw]")
    .forEach((button) => {
      button.onclick = () => void draw(Number(button.dataset.draw));
    });
  (byId("closeResults") as HTMLButtonElement).onclick = () =>
    (byId("results") as HTMLDialogElement).close();
  (byId("drawAgain") as HTMLButtonElement).onclick = () => void draw(lastDraw);

  return {
    showResults,
    showSynthesisResults: (results: ResultEntry[]) =>
      showResults(results, "synthesis"),
  };
}
