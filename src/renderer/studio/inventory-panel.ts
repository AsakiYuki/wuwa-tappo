import type { CatalogItem, PetState } from "../types";
import { labels, ROLE_NAMES, SERIES_NAMES } from "./constants";
import {
  filterCollection,
  sortCollection,
  type InventoryFilters,
  type InventoryPage,
  type InventoryType,
} from "./collection";
import { byId, createElement } from "./dom";

type FilterMetadata = {
  series: Record<string, string>;
  roles: Record<string, string>;
};

type VirtualGrid = HTMLDivElement & {
  items: CatalogItem[];
  columns: number;
};

interface InventoryPanelOptions {
  getItems(): CatalogItem[];
  getState(): PetState;
  getPage(): InventoryPage;
  getType(): InventoryType;
  setType(type: InventoryType): void;
  getFilters(): InventoryFilters;
  setFilters(filters: InventoryFilters): void;
  getFilterMetadata(): FilterMetadata;
  createCard(item: CatalogItem): HTMLElement;
}

const emptyFilters = (): InventoryFilters => ({
  series: "all",
  role: "all",
  rarity: "all",
});

export function mountInventoryPanel(options: InventoryPanelOptions) {
  const {
    getItems,
    getState,
    getPage,
    getType,
    getFilters,
    getFilterMetadata,
  } = options;
  let grids: VirtualGrid[] = [];
  let animationFrame = 0;

  function closeFilters() {
    document
      .querySelectorAll<HTMLElement>(".select-option:popover-open")
      .forEach((popup) => popup.hidePopover());
    document
      .querySelectorAll<HTMLElement>(".select-item--open")
      .forEach((container) => {
        container.classList.remove("select-item--open");
        container
          .querySelector(".select-input")
          ?.setAttribute("aria-expanded", "false");
      });
  }

  function positionFilter(
    box: HTMLElement,
    popup: HTMLElement,
    trigger: HTMLElement,
  ) {
    if (popup.matches(":popover-open")) {
      closeFilters();
      return;
    }
    closeFilters();

    const scale = Math.min(innerWidth / 1100, innerHeight / 756);
    const anchor = trigger.getBoundingClientRect();
    const isRoleFilter = box.dataset.filter === "role";
    const width = Math.min(isRoleFilter ? 560 : 240, (innerWidth - 24) / scale);

    popup.style.width = `${width}px`;
    popup.style.minWidth = "0";
    popup.style.transform = `scale(${scale})`;
    popup.style.transformOrigin = "top left";
    popup.style.left = `${Math.max(12, Math.min(anchor.left, innerWidth - width * scale - 12))}px`;

    const below = innerHeight - anchor.bottom - 18;
    const above = anchor.top - 18;
    const showAbove = below < 160 * scale && above > below;
    const availableHeight = Math.max(70, (showAbove ? above : below) / scale);
    const list = popup.querySelector<HTMLElement>(".select-option-list");
    if (list) list.style.maxHeight = `${Math.min(240, availableHeight - 16)}px`;

    popup.style.top = "0px";
    popup.showPopover();
    const height = popup.getBoundingClientRect().height;
    const top = showAbove ? anchor.top - height - 12 : anchor.bottom + 12;
    popup.style.top = `${Math.max(8, Math.min(top, innerHeight - height - 8))}px`;
    popup.style.setProperty(
      "--role-popup-arrow-left",
      `${Math.max(20, (anchor.left - parseFloat(popup.style.left)) / scale + 35)}px`,
    );
    popup.classList.toggle("popup-above", showAbove);
    box.classList.add("select-item--open");
    trigger.setAttribute("aria-expanded", "true");
  }

  function buildFilters() {
    closeFilters();
    const filterBar = byId("filterBar");
    filterBar.replaceChildren();

    const type = getType();
    if (type === "all") return;

    const metadata = getFilterMetadata();
    const filters = getFilters();
    const specifications: Array<
      [keyof InventoryFilters, string, Record<string, string>]
    > = [];
    if (type === "character")
      specifications.push(["series", "Series", metadata.series]);
    if (type === "character" || type === "emote") {
      specifications.push([
        "role",
        "Role",
        type === "emote" ? { 0: "Abby", ...metadata.roles } : metadata.roles,
      ]);
    }
    specifications.push(["rarity", "Rarity", labels]);

    for (const [key, title, values] of specifications) {
      const box = createElement(
        "div",
        `select-item${key === "role" ? " select-item--role" : ""}`,
      );
      box.dataset.filter = key;

      const trigger = createElement("button", "select-input");
      const currentValue = filters[key];
      const currentTitle =
        currentValue === "all"
          ? title
          : key === "series" && SERIES_NAMES[currentValue]
            ? SERIES_NAMES[currentValue]
            : key === "role" && ROLE_NAMES[currentValue]
              ? ROLE_NAMES[currentValue]
              : values[currentValue];
      trigger.append(createElement("span", "select-input-text", currentTitle));
      trigger.setAttribute("aria-haspopup", "listbox");
      trigger.setAttribute("aria-expanded", "false");

      const popup = createElement("div", "select-option");
      const list = createElement("div", "select-option-list");
      popup.setAttribute("popover", "manual");
      list.setAttribute("role", "listbox");

      const entries: Array<[string, string]> = [
        ["all", "All"],
        ...Object.entries(values),
      ];
      for (const [value, label] of entries) {
        const option = createElement(
          "button",
          `select-option-item${currentValue === value ? " select-option-item--active" : ""}`,
        );
        option.dataset.value = value;
        const optionTitle =
          value === "all"
            ? "All"
            : key === "series" && SERIES_NAMES[value]
              ? SERIES_NAMES[value]
              : key === "role" && ROLE_NAMES[value]
                ? ROLE_NAMES[value]
                : label;
        option.append(
          createElement("span", "select-option-item-text", optionTitle),
        );
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(currentValue === value));
        option.onclick = () => {
          options.setFilters({ ...getFilters(), [key]: value });
          render();
          byId("inventory").scrollTop = 0;
        };
        list.append(option);
      }

      popup.append(list);
      trigger.onclick = (event) => {
        event.stopPropagation();
        positionFilter(box, popup, trigger);
      };
      box.append(trigger, popup);
      filterBar.append(box);
    }
  }

  function layoutGrid(grid: VirtualGrid) {
    const columns = Math.max(1, Math.floor((grid.clientWidth - 48 + 20) / 140));
    const rows = Math.ceil(grid.items.length / columns);
    grid.columns = columns;
    grid.style.height = `${rows ? rows * 159 + 4 : 0}px`;
  }

  function paintVisibleItems() {
    animationFrame = 0;
    const viewport = byId("inventory").getBoundingClientRect();
    const scale = Math.min(innerWidth / 1100, innerHeight / 756);

    for (const grid of grids) {
      const rect = grid.getBoundingClientRect();
      const isCollapsed = Boolean(grid.closest(".atlas-list-hidden"));
      const firstRow = isCollapsed
        ? 0
        : Math.max(0, Math.floor((viewport.top - rect.top) / scale / 159) - 1);
      const lastRow = isCollapsed
        ? 0
        : Math.ceil((viewport.bottom - rect.top) / scale / 159) + 1;
      const firstIndex = firstRow * grid.columns;
      const lastIndex = Math.min(grid.items.length, lastRow * grid.columns);
      const visibleIds = new Set(
        grid.items.slice(firstIndex, lastIndex).map((item) => item.id),
      );

      for (const child of [...grid.children]) {
        const card = child as HTMLElement;
        if (
          !visibleIds.has(card.dataset.id ?? "") &&
          !card.contains(document.activeElement)
        )
          card.remove();
      }

      const mounted = new Map(
        [...grid.children].map((child) => {
          const card = child as HTMLElement;
          return [card.dataset.id ?? "", card];
        }),
      );

      for (let index = firstIndex; index < lastIndex; index++) {
        const item = grid.items[index];
        let card = mounted.get(item.id);
        if (!card) {
          card = options.createCard(item);
          grid.append(card);
        }
        card.style.position = "absolute";
        card.style.left = `${24 + (index % grid.columns) * 140}px`;
        card.style.top = `${12 + Math.floor(index / grid.columns) * 159}px`;
      }
    }
  }

  function schedulePaint() {
    if (!animationFrame)
      animationFrame = requestAnimationFrame(paintVisibleItems);
  }

  function addGrid(parent: HTMLElement, items: CatalogItem[]) {
    const grid = createElement("div", "atlas-list virtual-grid") as VirtualGrid;
    grid.items = items;
    grid.columns = 1;
    parent.append(grid);
    grids.push(grid);
    return grid;
  }

  function renderItems() {
    const container = byId("inventory");
    const scrollTop = container.scrollTop;
    const state = getState();
    const page = getPage();
    const type = getType();
    const visibleItems = filterCollection(
      getItems(),
      state,
      page,
      type,
      getFilters(),
    );
    const sortedItems = sortCollection(visibleItems, state, page, type);

    grids = [];
    container.replaceChildren();
    if (!sortedItems.length)
      container.append(createElement("div", "empty", "No items collected yet"));

    if (page === "atlas" && type === "all") {
      for (const rarity of ["epic", "rare", "uncommon", "common"] as const) {
        const items = sortedItems.filter((item) => item.rarity === rarity);
        if (!items.length) continue;

        const section = createElement("section", "atlas-group");
        const collected = items.filter((item) => state.owned[item.id]).length;
        const title = createElement(
          "button",
          "atlas-type",
          `${labels[rarity]} (${collected}/${items.length})`,
        );
        const wrapper = createElement("div", "atlas-list-wrapper");
        title.setAttribute("aria-expanded", "true");
        title.onclick = () => {
          section.classList.toggle("atlas-list-hidden");
          title.setAttribute(
            "aria-expanded",
            String(!section.classList.contains("atlas-list-hidden")),
          );
          paintVisibleItems();
        };
        section.append(title, wrapper);
        container.append(section);
        addGrid(wrapper, items);
      }
    } else {
      addGrid(container, sortedItems);
    }

    grids.forEach(layoutGrid);
    container.scrollTop = scrollTop;
    paintVisibleItems();
  }

  function render() {
    buildFilters();
    renderItems();
  }

  byId("inventory").addEventListener("scroll", schedulePaint, {
    passive: true,
  });
  document.addEventListener("click", (event) => {
    if (!(event.target as HTMLElement).closest(".select-item")) closeFilters();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeFilters();
  });

  document
    .querySelectorAll<HTMLButtonElement>("[data-type]")
    .forEach((button) => {
      button.onclick = () => {
        options.setType(button.dataset.type as InventoryType);
        options.setFilters(emptyFilters());
        document
          .querySelectorAll("[data-type]")
          .forEach((tab) => tab.classList.toggle("selected", tab === button));
        render();
        byId("inventory").scrollTop = 0;
      };
    });

  return {
    render,
    closeFilters,
    getItemCount: () =>
      grids.reduce((count, grid) => count + grid.items.length, 0),
  };
}
