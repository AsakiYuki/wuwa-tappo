const $ = (id) => document.getElementById(id),
  labels = {
    common: "Common",
    uncommon: "Uncommon",
    rare: "Rare",
    epic: "Epic",
  },
  typeNames = {
    character: "Character",
    accessory: "Accessory",
    emote: "Emote",
  };
const SERIES_NAMES = {
  1001: "Classic Series",
  1002: "Spinning Series",
  1003: "ARE Co-op",
  1004: "Chubby Series",
  1005: "Pixel Series",
  1006: "Miratsu Co-op",
  1007: "Costume Series",
};
const ROLE_NAMES = {
  0: "Abby / 阿布",
  1102: "Sanhua / 散华",
  1103: "Baizhi / 白芷",
  1104: "Lingyang / 凌阳",
  1105: "Zhezhi / 折枝",
  1106: "Youhu / 釉瑚",
  1107: "Carlotta / 珂莱塔",
  1108: "Phoebe / 绯雪",
  1109: "Roccia / 洛瑟菈",
  1110: "Sui Sui / 穗穗",
  1202: "Chixia / 炽霞",
  1203: "Encore / 安可",
  1204: "Mortefi / 莫特斐",
  1205: "Changli / 长离",
  1206: "Brant / 布兰特",
  1207: "Lupa / 露帕",
  1208: "Gaberina / 嘉贝莉娜",
  1209: "Morning / 莫宁",
  1210: "Amis / 爱弥斯",
  1211: "Danya / 达妮娅",
  1212: "Jingran / 景燃",
  1301: "Calcharo / 卡卡罗",
  1302: "Yinlin / 吟霖",
  1303: "Yuanwu / 渊武",
  1304: "Jinhsi / 今汐",
  1305: "Xiangli Yao / 相里要",
  1306: "Augusta / 奥古斯塔",
  1307: "Buling / 卜灵",
  1311: "Xin / 心",
  1402: "Yangyang / 秧秧",
  1403: "Aalto / 秋水",
  1404: "Jiyan / 忌炎",
  1405: "Jianxin / 鉴心",
  1407: "Xiakong / 夏空",
  1409: "Katisia / 卡提希娅",
  1410: "Yuno / 尤诺",
  1411: "Qiuyuan / 仇远",
  1412: "Sigrika / 西格莉卡",
  1413: "Qingsxiao / 清宵",
  1501: "Rover (M) / 漂泊者（男）",
  1502: "Rover (F) / 漂泊者（女）",
  1503: "Verina / 维里奈",
  1504: "Lumi / 灯灯",
  1505: "Shorekeeper / 守岸人",
  1506: "Phebe / 菲比",
  1507: "Zani / 赞妮",
  1508: "Chisaki / 千咲",
  1509: "Linnae / 琳奈",
  1510: "Lu Hess / 陆・赫斯",
  1601: "Taoqi / 桃祈",
  1602: "Danjin / 丹瑾",
  1603: "Camellya / 椿",
  1606: "Rococo / 洛可可",
  1607: "Cantarella / 坎特蕾拉",
  1608: "Phrolova / 弗洛洛",
  1610: "Yangyang (Plume) / 秧秧・玄翎",
};
let replaceSlot = null;
let state,
  items,
  filterMeta,
  map = new Map(),
  page = "collection",
  type = "all",
  filters = { series: "all", role: "all", rarity: "all" },
  toastTimer,
  lastDraw = 10,
  working = false,
  synthMode = "upgrade",
  synthGroup = null;
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function assetPath(src) {
  return src.startsWith("assets/") ? "../" + src : src;
}
function img(src) {
  const e = el("img");
  e.src = assetPath(src);
  e.loading = "lazy";
  e.draggable = false;
  return e;
}
function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("visible"), 3000);
}
async function command(name, arg) {
  const r = await petAPI.command(name, arg);
  if (!r.ok) toast(r.error);
  if (r.warning) toast(r.warning);
  return r;
}
function navigate(p) {
  replaceSlot = null;
  page = p;
  for (const k of ["collection", "draw", "synthesis", "presets", "settings"])
    $("page-" + k).hidden = k !== (p === "atlas" ? "collection" : p);
  document
    .querySelectorAll("[data-page]")
    .forEach((b) =>
      b.classList.toggle(
        "tab-btn--active",
        b.dataset.page === p ||
          (p === "presets" && b.dataset.page === "collection"),
      ),
    );
  $("currentOutfit").hidden = p === "atlas";
  $("page-collection").classList.toggle("role-panel", p !== "atlas");
  $("allTab").textContent = p === "atlas" ? "All" : "Recent";
  type = "all";
  filters = { series: "all", role: "all", rarity: "all" };
  document
    .querySelectorAll("[data-type]")
    .forEach((b) => b.classList.toggle("selected", b.dataset.type === type));
  render();
  $("inventory").scrollTop = 0;
}
document
  .querySelectorAll("[data-page]")
  .forEach((b) => (b.onclick = () => navigate(b.dataset.page)));
for (const id of ["hidePanel", "closePanel"])
  $(id).onclick = () => command("hide");
function equipped(it) {
  return it.type === "character"
    ? state.character === it.id
    : it.type === "accessory"
      ? state.accessory === it.id
      : state.emotes.includes(it.id);
}
function card(it, interactive = true) {
  const owned = state.owned[it.id] || 0,
    kind = it.type === "character" ? "character_skin" : it.type,
    c = el(
      "article",
      "atlas-item item-card atlas-item--" +
        kind +
        (!owned ? " atlas-item--unowned" : "") +
        (equipped(it) && page !== "atlas" ? " atlas-item--active" : ""),
    );
  c.dataset.id = it.id;
  const titleName = getItemName(it);
  c.title = titleName + " · " + labels[it.rarity];
  const art = el("div", "atlas-thumb atlas-thumb--" + it.rarity);
  art.append(img(it.thumbnail));
  const name = el("div", "atlas-name");
  name.append(el("div", "atlas-name-inner", titleName));
  c.append(art, name, el("span", "atlas-type-icon"));
  if (owned > 1) c.append(el("span", "atlas-qty", String(owned)));
  if (interactive) {
    const fav = el(
      "button",
      "atlas-collect" +
        (state.favorites.includes(it.id) ? " atlas-collect--active" : ""),
    );
    fav.title = "Favorite / Unfavorite";
    fav.onclick = (e) => {
      e.stopPropagation();
      command("favorite", it.id);
    };
    c.append(fav);
    c.tabIndex = 0;
    c.onclick = async () => {
      if (!owned) {
        toast("Obtain via chests or synthesis");
        return;
      }
      if (it.type === "emote" && replaceSlot !== null) {
        const slot = replaceSlot;
        if ((await command("emote-replace", { id: it.id, slot })).ok) {
          replaceSlot = null;
          render();
          toast("Emote " + (slot + 1) + " replaced with " + titleName);
        }
        return;
      }
      if (it.type === "character") {
        if (equipped(it)) {
          toast(titleName + " is already equipped");
          return;
        }
        const result = await command("equip", it.id);
        if (result.ok) {
          state.character = it.id;
          render();
          toast("Equipped " + titleName);
        }
        return;
      }
      if (it.type === "emote" && !equipped(it) && state.emotes.length >= 5) {
        chooseEmote(it);
        return;
      }
      const result = await command("equip", it.id);
      if (result.ok) render();
    };
    c.onkeydown = (e) => {
      if (e.target === c && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        c.click();
      }
    };
    if (it.type === "emote" && owned)
      c.oncontextmenu = (e) => {
        e.preventDefault();
        command("emote", it.id);
      };
  }
  return c;
}
function closeFilters() {
  document
    .querySelectorAll(".select-option:popover-open")
    .forEach((p) => p.hidePopover());
  document.querySelectorAll(".select-item--open").forEach((b) => {
    b.classList.remove("select-item--open");
    b.querySelector(".select-input").setAttribute("aria-expanded", "false");
  });
}
function openFilter(box, popup, trigger) {
  if (popup.matches(":popover-open")) {
    closeFilters();
    return;
  }
  closeFilters();
  const scale = Math.min(innerWidth / 1100, innerHeight / 756),
    anchor = trigger.getBoundingClientRect(),
    role = box.dataset.filter === "role",
    width = Math.min(role ? 560 : 240, (innerWidth - 24) / scale);
  popup.style.width = width + "px";
  popup.style.minWidth = "0";
  popup.style.transform = "scale(" + scale + ")";
  popup.style.transformOrigin = "top left";
  popup.style.left =
    Math.max(12, Math.min(anchor.left, innerWidth - width * scale - 12)) + "px";
  const below = innerHeight - anchor.bottom - 18,
    above = anchor.top - 18,
    up = below < 160 * scale && above > below,
    available = Math.max(70, (up ? above : below) / scale);
  const list = popup.querySelector(".select-option-list");
  list.style.maxHeight = Math.min(240, available - 16) + "px";
  popup.style.top = "0px";
  popup.showPopover();
  const height = popup.getBoundingClientRect().height;
  popup.style.top =
    Math.max(
      8,
      Math.min(
        up ? anchor.top - height - 12 : anchor.bottom + 12,
        innerHeight - height - 8,
      ),
    ) + "px";
  popup.style.setProperty(
    "--role-popup-arrow-left",
    Math.max(20, (anchor.left - parseFloat(popup.style.left)) / scale + 35) +
      "px",
  );
  popup.classList.toggle("popup-above", up);
  box.classList.add("select-item--open");
  trigger.setAttribute("aria-expanded", "true");
}
function buildFilters() {
  closeFilters();
  $("filterBar").replaceChildren();
  if (type === "all") return;
  const specs = [];
  if (type === "character") specs.push(["series", "Series", filterMeta.series]);
  if (type === "character" || type === "emote")
    specs.push([
      "role",
      "Role",
      type === "emote"
        ? { 0: "Abby / 阿布", ...filterMeta.roles }
        : filterMeta.roles,
    ]);
  specs.push(["rarity", "Rarity", labels]);
  for (const [key, label, options] of specs) {
    const box = el(
      "div",
      "select-item" + (key === "role" ? " select-item--role" : ""),
    );
    box.dataset.filter = key;
    const trigger = el("button", "select-input"),
      text = el(
        "span",
        "select-input-text",
        filters[key] === "all"
          ? label
          : key === "series" && SERIES_NAMES[filters[key]]
            ? SERIES_NAMES[filters[key]]
            : key === "role" && ROLE_NAMES[filters[key]]
              ? ROLE_NAMES[filters[key]]
              : options[filters[key]],
      );
    trigger.append(text);
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    const popup = el("div", "select-option"),
      list = el("div", "select-option-list");
    popup.setAttribute("popover", "manual");
    list.setAttribute("role", "listbox");
    for (const [value, name] of [["all", "All"], ...Object.entries(options)]) {
      const b = el(
        "button",
        "select-option-item" +
          (filters[key] === value ? " select-option-item--active" : ""),
      );
      b.dataset.value = value;
      const labelText =
        value === "all"
          ? "All"
          : key === "series" && SERIES_NAMES[value]
            ? SERIES_NAMES[value]
            : key === "role" && ROLE_NAMES[value]
              ? ROLE_NAMES[value]
              : name;
      b.append(el("span", "select-option-item-text", labelText));
      b.setAttribute("role", "option");
      b.setAttribute("aria-selected", String(filters[key] === value));
      b.onclick = () => {
        closeFilters();
        filters[key] = value;
        inventory();
        buildFilters();
        $("inventory").scrollTop = 0;
      };
      list.append(b);
    }
    popup.append(list);
    trigger.onclick = (e) => {
      e.stopPropagation();
      openFilter(box, popup, trigger);
    };
    box.append(trigger, popup);
    $("filterBar").append(box);
  }
}
document.addEventListener("click", (e) => {
  if (!e.target.closest(".select-item")) closeFilters();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeFilters();
});
function filteredItems() {
  return items.filter(
    (x) =>
      (type === "all" || x.type === type) &&
      (page === "atlas" || state.owned[x.id]) &&
      (filters.series === "all" || x.code === filters.series) &&
      (filters.role === "all" || String(x.roleId) === filters.role) &&
      (filters.rarity === "all" || x.rarity === filters.rarity),
  );
}
let virtualGrids = [],
  virtualFrame = 0;
function layoutGrid(grid) {
  const columns = Math.max(1, Math.floor((grid.clientWidth - 48 + 20) / 140)),
    rows = Math.ceil(grid._items.length / columns);
  grid._columns = columns;
  grid.style.height = (rows ? rows * 159 + 4 : 0) + "px";
}
function paintInventory() {
  virtualFrame = 0;
  const bounds = $("inventory").getBoundingClientRect(),
    scale = Math.min(innerWidth / 1100, innerHeight / 756);
  for (const grid of virtualGrids) {
    const items = grid._items,
      columns = grid._columns,
      rect = grid.getBoundingClientRect(),
      collapsed = grid.closest(".atlas-list-hidden");
    const first = collapsed
        ? 0
        : Math.max(0, Math.floor((bounds.top - rect.top) / scale / 159) - 1) *
          columns,
      last = collapsed
        ? 0
        : Math.min(
            items.length,
            (Math.ceil((bounds.bottom - rect.top) / scale / 159) + 1) * columns,
          );
    const keep = new Set(
      items.slice(first, Math.max(first, last)).map((it) => it.id),
    );
    for (const child of [...grid.children])
      if (
        !keep.has(child.dataset.id) &&
        !child.contains(document.activeElement)
      )
        child.remove();
    const mounted = new Map([...grid.children].map((c) => [c.dataset.id, c]));
    for (let index = first; index < last; index++) {
      const it = items[index];
      let c = mounted.get(it.id);
      if (!c) {
        c = card(it);
        grid.append(c);
      }
      c.style.position = "absolute";
      c.style.left = 24 + (index % columns) * 140 + "px";
      c.style.top = 12 + Math.floor(index / columns) * 159 + "px";
    }
  }
}
function scheduleInventory() {
  if (!virtualFrame) virtualFrame = requestAnimationFrame(paintInventory);
}
$("inventory").addEventListener("scroll", scheduleInventory, { passive: true });
function addGrid(parent, list) {
  const grid = el("div", "atlas-list virtual-grid");
  grid._items = list;
  parent.append(grid);
  virtualGrids.push(grid);
  return grid;
}
function inventory() {
  const scroller = $("inventory"),
    scrollTop = scroller.scrollTop;
  const list = filteredItems(),
    order = new Map(
      state.history.map((x, i) => [x.id, state.history.length - i]),
    );
  list.sort(
    (a, b) =>
      Number(!!state.owned[b.id]) - Number(!!state.owned[a.id]) ||
      Number(state.favorites.includes(b.id)) -
        Number(state.favorites.includes(a.id)) ||
      (page === "collection" && type === "all"
        ? (order.get(b.id) || 0) - (order.get(a.id) || 0)
        : 0) ||
      Object.keys(labels).indexOf(b.rarity) -
        Object.keys(labels).indexOf(a.rarity) ||
      a.assetId - b.assetId,
  );
  virtualGrids = [];
  scroller.replaceChildren();
  if (!list.length)
    scroller.append(el("div", "empty", "No items collected yet"));
  if (page === "atlas" && type === "all") {
    for (const rarity of ["epic", "rare", "uncommon", "common"]) {
      const group = list.filter((x) => x.rarity === rarity);
      if (!group.length) continue;
      const section = el("section", "atlas-group"),
        title = el(
          "button",
          "atlas-type",
          labels[rarity] +
            " (" +
            group.filter((x) => state.owned[x.id]).length +
            "/" +
            group.length +
            ")",
        ),
        wrap = el("div", "atlas-list-wrapper");
      title.setAttribute("aria-expanded", "true");
      title.onclick = () => {
        section.classList.toggle("atlas-list-hidden");
        title.setAttribute(
          "aria-expanded",
          String(!section.classList.contains("atlas-list-hidden")),
        );
        paintInventory();
      };
      section.append(title, wrap);
      scroller.append(section);
      addGrid(wrap, group);
    }
  } else {
    addGrid(scroller, list);
  }
  for (const grid of virtualGrids) layoutGrid(grid);
  scroller.scrollTop = scrollTop;
  paintInventory();
}
function layeredPreview(character, accessory) {
  const box = el("div", "preset-img"),
    c = map.get(character);
  box.append(img(c.layers.head1), img(c.layers.body1));
  if (accessory) {
    const im = img(map.get(accessory).image);
    im.style.transform =
      "translate(" +
      (c.offsetX || 0) * 0.5 +
      "px," +
      (c.offsetY || 0) * 0.5 +
      "px)";
    box.append(im);
  }
  return box;
}
function preview() {
  const c = map.get(state.character),
    a = map.get(state.accessory);
  $("heroHead").src = assetPath(c.layers.head1);
  $("heroBody").src = assetPath(c.layers.body1);
  $("heroAccessory").hidden = !a;
  if (a) {
    $("heroAccessory").src = assetPath(a.image);
    $("heroAccessory").style.transform =
      "translate(" +
      (c.offsetX || 0) * 1.2 +
      "px," +
      (c.offsetY || 0) * 1.2 +
      "px)";
  }
  $("previewEmotes").replaceChildren();
  for (let i = 0; i < 5; i++) {
    const id = state.emotes[i],
      b = el("button", "preset-preview-emote preset-preview-emote" + (i + 1)),
      frame = el("div", "preset-preview-emote-img");
    if (id) {
      frame.append(img(map.get(id).image));
      b.title = "Replace emote " + (i + 1) + " · " + getItemName(map.get(id));
      b.onclick = () => chooseEmoteSlot(i);
      b.oncontextmenu = (e) => {
        e.preventDefault();
        command("emote", id);
      };
    } else {
      b.title = "Equip emote " + (i + 1);
      b.onclick = () => chooseEmoteSlot(i);
    }
    b.classList.toggle("replacing-emote", replaceSlot === i);
    b.append(
      frame,
      el(
        "span",
        "emote-change-label",
        replaceSlot === i ? "Selecting" : "Change",
      ),
    );
    $("previewEmotes").append(b);
  }
  $("miniPresets").replaceChildren();
  for (let i = 0; i < Math.max(6, state.presets.length + 1); i++) {
    const p = state.presets[i],
      b = el("button", "preset-item" + (!p ? " preset-item--add" : ""));
    if (p) {
      b.append(layeredPreview(p.character, p.accessory));
      b.title = p.name;
      b.onclick = () => command("preset-load", p.id);
      b.oncontextmenu = (e) => {
        e.preventDefault();
        navigate("presets");
      };
    } else {
      b.title = "Add Preset";
      b.onclick = () => navigate("presets");
    }
    $("miniPresets").append(b);
  }
}
function render() {
  if (!state || !items) return;
  $("replaceBar").hidden = replaceSlot === null;
  $("replaceHint").textContent =
    replaceSlot === null
      ? ""
      : "Replacing emote " +
        (replaceSlot + 1) +
        " · Select an owned emote below";
  preview();
  if (page === "collection" || page === "atlas") {
    buildFilters();
    inventory();
  }
  if (page === "draw") {
    $("pity").textContent =
      "Epic pity in " + (50 - state.pity) + " pulls · Unlimited";
    $("drawTotal").textContent =
      "Total opened: " + state.draws.toLocaleString();
    $("history").replaceChildren();
    for (const h of state.history.slice(0, 20)) {
      const it = map.get(h.id);
      if (it) {
        const im = img(it.thumbnail);
        im.title = getItemName(it);
        $("history").append(im);
      }
    }
  }
  if (page === "synthesis") synthesis();
  if (page === "presets") presets();
  if (page === "settings") settings();
}
document.querySelectorAll("[data-type]").forEach(
  (b) =>
    (b.onclick = () => {
      replaceSlot = null;
      $("replaceBar").hidden = true;
      preview();
      type = b.dataset.type;
      filters = { series: "all", role: "all", rarity: "all" };
      document
        .querySelectorAll("[data-type]")
        .forEach((t) => t.classList.toggle("selected", t === b));
      buildFilters();
      inventory();
      $("inventory").scrollTop = 0;
    }),
);
function showResults(results, source) {
  $("resultTitle").textContent =
    source === "draw" ? "Items Obtained" : "Synthesis Successful";
  $("resultGrid").replaceChildren();
  $("resultGrid").classList.toggle("single", results.length === 1);
  for (const [index, r] of results.entries()) {
    const it = map.get(r.id),
      c = el("article", "result-card");
    c.style.animationDelay = index * 0.04 + "s";
    c.append(card(it, false), el("p", "result-quality", labels[it.rarity]));
    if (r.fresh) c.append(el("span", "new", "NEW"));
    if (it.type !== "emote") {
      const b = el("button", "common-btn", "Equip");
      b.onclick = async () => {
        if ((await command("equip", it.id)).ok)
          toast("Equipped " + getItemName(it));
      };
      c.append(b);
    }
    $("resultGrid").append(c);
  }
  $("drawAgain").hidden = source !== "draw";
  $("drawAgain").textContent =
    lastDraw === 10 ? "Draw 10 Again ∞" : "Draw 1 Again ∞";
  if (!$("results").open) $("results").showModal();
}
async function draw(n) {
  if (working) return;
  working = true;
  lastDraw = n;
  try {
    const r = await command("draw", n);
    if (r.ok) showResults(r.result, "draw");
  } finally {
    working = false;
  }
}
document
  .querySelectorAll("[data-draw]")
  .forEach((b) => (b.onclick = () => draw(Number(b.dataset.draw))));
$("closeResults").onclick = () => $("results").close();
$("drawAgain").onclick = () => draw(lastDraw);
function groups() {
  const out = [];
  for (const t of ["character", "accessory", "emote"])
    for (const r of Object.keys(labels)) {
      const target =
        synthMode === "same"
          ? r
          : Object.keys(labels)[Object.keys(labels).indexOf(r) + 1];
      if (!target || !items.some((x) => x.type === t && x.rarity === target))
        continue;
      const candidates = items.filter((x) => x.type === t && x.rarity === r),
        count = candidates.reduce(
          (s, x) => s + Math.max(0, (state.owned[x.id] || 0) - 1),
          0,
        );
      out.push({ type: t, rarity: r, count, candidates });
    }
  return out;
}
function synthesis() {
  const cost = synthMode === "same" ? 5 : 10,
    g = groups().find(
      (x) =>
        synthGroup &&
        x.type === synthGroup.type &&
        x.rarity === synthGroup.rarity,
    );
  $("synthesisSlots").replaceChildren();
  const copies = [];
  if (g)
    for (const it of g.candidates) {
      const take = Math.min(
        cost - copies.length,
        Math.max(0, (state.owned[it.id] || 0) - 1),
      );
      for (let k = 0; k < take; k++) copies.push(it);
    }
  for (let i = 0; i < cost; i++) {
    const slot = el("button", "synthesis-item");
    if (copies[i]) {
      const thumb = el("div", "synthesis-thumb synthesis-thumb--" + g.rarity);
      thumb.append(img(copies[i].thumbnail));
      slot.append(thumb);
    } else slot.append(el("div", "synthesis-add"));
    slot.onclick = openMaterials;
    $("synthesisSlots").append(slot);
  }
  $("synthesisTip").textContent =
    "Combine " +
    cost +
    " items of the same type and rarity to synthesize 1 random " +
    (synthMode === "same" ? "same-tier" : "higher-tier") +
    " item.";
  document
    .querySelectorAll("[data-synth-count]")
    .forEach(
      (b) => (b.disabled = !g || g.count < cost * Number(b.dataset.synthCount)),
    );
  $("synthesisSelected").textContent = g
    ? typeNames[g.type] + " · " + labels[g.rarity] + " · Duplicates: " + g.count
    : "";
}
function openMaterials() {
  $("materialGroups").replaceChildren();
  for (const g of groups()) {
    const b = el("button", "material-group");
    b.append(
      el("strong", "", typeNames[g.type] + " · " + labels[g.rarity]),
      el("p", "", g.count + " duplicates"),
    );
    b.disabled = g.count < (synthMode === "same" ? 5 : 10);
    b.onclick = () => {
      synthGroup = g;
      $("materialPicker").close();
      synthesis();
    };
    $("materialGroups").append(b);
  }
  if (!$("materialPicker").open) $("materialPicker").showModal();
}
$("closeMaterials").onclick = () => $("materialPicker").close();
$("autoSelect").onclick = () => {
  synthGroup = groups().find((g) => g.count >= (synthMode === "same" ? 5 : 10));
  if (!synthGroup) toast("Not enough duplicate items for synthesis");
  synthesis();
};
document.querySelectorAll("[data-synth-mode]").forEach(
  (b) =>
    (b.onclick = () => {
      synthMode = b.dataset.synthMode;
      synthGroup = null;
      document
        .querySelectorAll("[data-synth-mode]")
        .forEach((x) => x.classList.toggle("selected", x === b));
      synthesis();
    }),
);
document.querySelectorAll("[data-synth-count]").forEach(
  (b) =>
    (b.onclick = async () => {
      if (working || !synthGroup) return;
      working = true;
      try {
        const r = await command("synthesize", {
          n: Number(b.dataset.synthCount),
          rarity: synthGroup.rarity,
          type: synthGroup.type,
          mode: synthMode,
        });
        if (r.ok) showResults(r.result, "synthesis");
      } finally {
        working = false;
      }
    }),
);
function presets() {
  $("presets").replaceChildren();
  if (!state.presets.length)
    $("presets").append(el("div", "empty", "No presets saved"));
  for (const p of state.presets) {
    const c = el("article", "preset");
    c.append(img(map.get(p.character).thumbnail), el("h3", "", p.name));
    const actions = el("div", "actions"),
      use = el("button", "common-btn", "Equip"),
      del = el("button", "common-btn", "Delete");
    use.onclick = () => command("preset-load", p.id);
    del.onclick = () => {
      if (confirm("Delete this preset?")) command("preset-delete", p.id);
    };
    actions.append(use, del);
    c.append(actions);
    $("presets").append(c);
  }
}
$("savePreset").onclick = async () => {
  if ((await command("preset-save", $("presetName").value || "My Outfit")).ok) {
    $("presetName").value = "";
    navigate("collection");
  }
};
function buildSettings() {
  const rows = $("settingsRows");
  const sw = (key, title, sub) => {
    const row = el("div", "setting-item" + (sub ? " has-sub" : "")),
      text = el("div");
    text.append(el("div", "setting-title", title));
    if (sub) text.append(el("div", "setting-sub", sub));
    const label = el("label", "setting-switch"),
      input = el("input");
    input.type = "checkbox";
    input.dataset.setting = key;
    input.setAttribute("aria-label", title);
    label.append(input, el("span", "setting-slider"));
    row.append(text, label);
    rows.append(row);
  };
  sw("autoStart", "Launch at Startup");
  sw("lockDrag", "Lock Pet Position", "Prevents moving the pet by dragging.");
  sw(
    "hoverFade",
    "Hover on Fade",
    "Pet becomes semi-transparent when mouse hovers over it.",
  );
  sw(
    "showChest",
    "Always Show Chest",
    "Always show chest shortcut next to pet.",
  );
  sw("showKeyboard", "Show Keyboard");
  sw("counterLeft", "Move Counter to Left");
  for (const [key, title, min, max, step] of [
    ["opacity", "Pet Opacity", 0.3, 1, 0.05],
    ["scale", "Pet Scale", 0.65, 1.5, 0.05],
  ]) {
    const row = el("div", "setting-item"),
      content = el("div", "setting-content"),
      range = el("input", "setting-range"),
      value = el("span", "setting-value");
    range.type = "range";
    range.min = min;
    range.max = max;
    range.step = step;
    range.dataset.setting = key;
    range.setAttribute("aria-label", title);
    value.id = key + "Value";
    content.append(range, value);
    row.append(el("div", "setting-title", title), content);
    rows.append(row);
  }
  const display = el("div", "setting-item has-sub"),
    displayText = el("div");
  displayText.append(
    el("div", "setting-title", "Display Screen:"),
    el("div", "setting-sub", "Press F8 to cycle"),
  );
  displayText.firstChild.id = "monitorLabel";
  const button = el("button", "setting-btn", "Cycle Screen");
  button.onclick = () =>
    command("settings", {
      monitor: (state.settings.monitor + 1) % window.monitorCount,
    });
  display.append(displayText, button);
  rows.append(display);
  sw("alwaysOnTop", "Always On Top");
  sw("inputEnabled", "Keyboard & Mouse Reaction");
  sw("passthrough", "Mouse Passthrough", "Press Ctrl+Alt+P to toggle.");
  const version = el("div", "setting-item"),
    info = el("button", "setting-btn", "Version Info");
  version.append(
    el("div", "setting-title", "Current Version v1.0.3 · Offline"),
    info,
  );
  info.onclick = () => toast("Local version · All assets built-in offline");
  rows.append(version);
  const dataRow = el("div", "setting-item has-sub"),
    dataLabel = el("div");
  dataLabel.append(
    el("div", "setting-title", "Collection Data"),
    el("div", "setting-sub", "Unlock every item or start over."),
  );
  const dataActions = el("div", "setting-content"),
    unlock = el("button", "setting-btn", "Unlock All"),
    reset = el("button", "setting-btn", "Reset");
  unlock.id = "unlockAll";
  reset.id = "resetData";
  unlock.onclick = async () => {
    if ((await command("unlock-all")).ok)
      toast("All characters, accessories and emotes unlocked");
  };
  reset.onclick = () => {
    if (
      confirm(
        "Reset all collection data, counters, presets and settings? This cannot be undone.",
      )
    )
      command("reset-data");
  };
  dataActions.append(unlock, reset);
  dataRow.append(dataLabel, dataActions);
  rows.append(dataRow);
  document
    .querySelectorAll("[data-setting]")
    .forEach((e) =>
      e.addEventListener("change", () =>
        command("settings", {
          [e.dataset.setting]:
            e.type === "checkbox" ? e.checked : Number(e.value),
        }),
      ),
    );
}
buildSettings();
function settings() {
  document.querySelectorAll("[data-setting]").forEach((e) => {
    const v = state.settings[e.dataset.setting];
    if (e.type === "checkbox") e.checked = v;
    else {
      e.value = v;
      e.style.setProperty(
        "--range-progress",
        ((v - Number(e.min)) / (Number(e.max) - Number(e.min))) * 100 + "%",
      );
    }
  });
  $("scaleValue").textContent = Math.round(state.settings.scale * 100) + "%";
  $("opacityValue").textContent =
    Math.round(state.settings.opacity * 100) + "%";
  $("monitorLabel").textContent =
    "Display Screen: " + (state.settings.monitor + 1);
}
$("openFolder").onclick = () => command("folder");
$("recenter").onclick = () => command("recenter");
$("quit").onclick = () => command("quit");
petAPI.onState((s) => {
  state = s;
  render();
});
petAPI.onStatus((s) => {
  $("hookStatus").textContent = s.hook;
  if (s.warning) toast(s.warning);
});
petAPI.onPage((p) => navigate(p));

function chooseEmoteSlot(slot) {
  navigate("collection");
  replaceSlot = Math.min(slot, state.emotes.length);
  type = "emote";
  document
    .querySelectorAll("[data-type]")
    .forEach((b) => b.classList.toggle("selected", b.dataset.type === type));
  render();
  $("inventory").scrollTop = 0;
}
$("cancelReplace").onclick = () => {
  replaceSlot = null;
  render();
};

function chooseEmote(it) {
  $("emotePickerTip").textContent =
    "Click a slot below to equip the selected emote.";
  $("emotePickerTitle").textContent = "Equip " + getItemName(it);
  $("emoteSlots").replaceChildren();
  for (let slot = 0; slot < 5; slot++) {
    const old = map.get(state.emotes[slot]),
      b = el("button", "emote-replace-slot");
    b.dataset.slot = slot;
    if (old) b.append(img(old.image));
    b.append(
      el(
        "span",
        "",
        String(slot + 1) + " · " + (old ? getItemName(old) : "Empty Slot"),
      ),
    );
    b.onclick = async () => {
      const result = await command("emote-replace", { id: it.id, slot });
      if (result.ok) {
        $("emotePicker").close();
        toast("Replaced emote " + (slot + 1));
      }
    };
    $("emoteSlots").append(b);
  }
  $("emotePicker").showModal();
}
$("closeEmotePicker").onclick = () => $("emotePicker").close();
document
  .querySelectorAll("[data-window]")
  .forEach((b) => (b.onclick = () => command("window", b.dataset.window)));
$("panelDrag").ondblclick = () => command("window", "maximize");
for (const edge of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) {
  const h = el("div", "resize-handle resize-" + edge);
  let drag = null;
  h.onpointerdown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    drag = { x: e.screenX, y: e.screenY };
    h.setPointerCapture(e.pointerId);
  };
  h.onpointermove = (e) => {
    if (!drag) return;
    const dx = e.screenX - drag.x,
      dy = e.screenY - drag.y;
    drag = { x: e.screenX, y: e.screenY };
    petAPI.resizeWindow(edge, dx, dy);
  };
  h.onpointerup = h.onpointercancel = () => {
    drag = null;
  };
  $("resizeHandles").append(h);
}

function resize() {
  closeFilters();
  const scale = Math.min(innerWidth / 1100, innerHeight / 756),
    root = $("replicaRoot");
  root.style.transform = "scale(" + scale + ")";
  root.style.left = Math.max(0, (innerWidth - 1100 * scale) / 2) + "px";
  root.style.top = Math.max(0, (innerHeight - 756 * scale) / 2) + "px";
}
addEventListener("resize", resize);
resize();
petAPI.init().then((d) => {
  state = d.state;
  items = d.items;
  filterMeta = d.filters;
  map = new Map(items.map((x) => [x.id, x]));
  window.monitorCount = d.monitors.length;
  $("hookStatus").textContent = d.status.hook;
  if (d.status.warning) toast(d.status.warning);
  render();
});
window.__studioTest = () => ({
  page,
  type,
  filters,
  replaceSlot,
  owned: Object.keys(state?.owned || {}).filter((k) => state.owned[k] > 0)
    .length,
  draws: state?.draws,
  count: state?.count,
  visibleCards: document.querySelectorAll("#inventory .item-card").length,
  loadedCards: virtualGrids.reduce((n, g) => n + g._items.length, 0),
  filterCount: document.querySelectorAll("#filterBar .select-item").length,
  groupCount: document.querySelectorAll("#inventory .atlas-group").length,
  errors: [],
});
