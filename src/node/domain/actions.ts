import type {
  CatalogItem,
  CollectionState,
  HistoryEntry,
  Rarity,
  SynthesisOptions,
} from "../types.js";
import { RARITIES } from "./constants.js";

function rarity(rng: () => number, min = 0): Rarity {
  const n = rng();
  let i = n < 0.65 ? 0 : n < 0.9 ? 1 : n < 0.99 ? 2 : 3;
  return RARITIES[Math.max(i, min)];
}
function choose<T>(pool: T[], rng: () => number): T {
  if (!pool.length) throw Error("The item pool is empty");
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}
function award(
  s: CollectionState,
  item: CatalogItem,
  source: HistoryEntry["source"],
): HistoryEntry {
  const fresh = !s.owned[item.id];
  s.owned[item.id] = (s.owned[item.id] || 0) + 1;
  const r = { id: item.id, fresh, source, at: Date.now() };
  s.history.unshift(r);
  s.history = s.history.slice(0, 100);
  return r;
}
function draw(
  s: CollectionState,
  items: CatalogItem[],
  n: number,
  rng: () => number = Math.random,
): HistoryEntry[] {
  if (n !== 1 && n !== 10)
    throw Error("Choose a single draw or a ten-draw pull");
  const results = [];
  let high = false;
  for (let i = 0; i < n; i++) {
    s.pity++;
    let level = rarity(rng, n === 10 && i === 9 && !high ? 1 : 0);
    if (s.pity >= 50) level = "epic";
    const pool = items.filter((x) => x.rarity === level);
    const item = choose(pool, rng);
    if (level === "epic") s.pity = 0;
    if (level !== "common") high = true;
    results.push(award(s, item, "draw"));
    s.draws++;
  }
  return results;
}
function synthesize(
  s: CollectionState,
  items: CatalogItem[],
  n: number,
  level: Rarity,
  rng: () => number = Math.random,
  options: SynthesisOptions = {},
): HistoryEntry[] {
  const type = options.type || "character",
    mode = options.mode || "upgrade",
    cost = mode === "same" ? 5 : 10;
  if (
    ![1, 10].includes(n) ||
    !RARITIES.includes(level) ||
    !["character", "accessory", "emote"].includes(type) ||
    !["same", "upgrade"].includes(mode)
  )
    throw Error("Invalid synthesis options");
  if (mode === "upgrade" && level === "epic")
    throw Error("Epic is the highest rarity; choose same-tier synthesis");
  const source = items.filter((x) => x.rarity === level && x.type === type),
    count = source.reduce(
      (sum, x) => sum + Math.max(0, (s.owned[x.id] || 0) - 1),
      0,
    );
  if (count < cost * n)
    throw Error(
      "Not enough duplicate items of this type and rarity; required: " +
        cost * n +
        " items",
    );
  const target =
      mode === "same" ? level : RARITIES[RARITIES.indexOf(level) + 1],
    draft = structuredClone(s),
    results = [];
  for (let i = 0; i < n; i++) {
    let left = cost;
    for (const it of source) {
      const take = Math.min(left, Math.max(0, (draft.owned[it.id] || 0) - 1));
      if (take > 0) draft.owned[it.id] -= take;
      left -= take;
      if (!left) break;
    }
    const pool = items.filter((x) => x.rarity === target && x.type === type),
      unowned = pool.filter((x) => !draft.owned[x.id]);
    if (!pool.length) throw Error("No target-rarity items exist for this type");
    results.push(
      award(draft, choose(unowned.length ? unowned : pool, rng), "synthesis"),
    );
  }
  Object.assign(s, draft);
  return results;
}
function equip(s: CollectionState, items: CatalogItem[], id: string): void {
  const item = items.find((x) => x.id === id);
  if (!item || !s.owned[id]) throw Error("Obtain this item first");
  if (item.type === "character") s.character = id;
  else if (item.type === "accessory")
    s.accessory = s.accessory === id ? "" : id;
  else {
    if (s.emotes.includes(id)) s.emotes = s.emotes.filter((x) => x !== id);
    else {
      if (s.emotes.length >= 5)
        throw Error("Equip up to 5 emotes; remove one first");
      s.emotes.push(id);
    }
  }
}
function registerTap(
  s: CollectionState,
  items: CatalogItem[],
  rng: () => number = Math.random,
): string | null {
  s.count = (s.count + 1) % 1000;
  if (s.count !== 0) return null;
  const selected = items.filter(
    (x) => x.type === "emote" && s.owned[x.id] > 0 && s.emotes.includes(x.id),
  );
  return selected.length ? choose(selected, rng).id : null;
}
function replaceEmote(
  s: CollectionState,
  items: CatalogItem[],
  id: string,
  slot: number,
): void {
  if (!Number.isInteger(slot) || slot < 0 || slot > 4)
    throw Error("Invalid emote slot");
  if (!s.owned[id] || !items.some((x) => x.id === id && x.type === "emote"))
    throw Error("Obtain this emote first");
  slot = Math.min(slot, s.emotes.length);
  const index = s.emotes.indexOf(id);
  if (index === slot) return;
  if (index >= 0) {
    const old = s.emotes[slot];
    s.emotes[slot] = id;
    if (old) s.emotes[index] = old;
    else s.emotes.splice(index, 1);
  } else if (slot >= s.emotes.length) s.emotes.push(id);
  else s.emotes[slot] = id;
}
export { draw, synthesize, equip, registerTap, replaceEmote };
