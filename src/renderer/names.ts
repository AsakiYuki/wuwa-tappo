import type { CatalogItem } from "./types";

export function getItemName(item?: Pick<CatalogItem, "name"> | null): string {
  return item?.name ?? "";
}
