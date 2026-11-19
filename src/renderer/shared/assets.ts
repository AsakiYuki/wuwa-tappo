import type { CatalogItem } from "./types"

/** Catalog paths are relative to the app root; renderer pages live one level below it. */
export function assetPath(file: string | undefined): string {
	if (!file) return ""
	return file.startsWith("assets/") ? `../${file}` : file
}

export function itemName(item?: Pick<CatalogItem, "name"> | null): string {
	return item?.name ?? ""
}

export const isMac =
	window.petAPI?.platform === "darwin" ||
	/Mac|iPhone|iPod|iPad/.test(navigator.platform) ||
	/Macintosh|Mac OS X/.test(navigator.userAgent)
