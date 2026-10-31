import { assetPath } from "../types";

/** DOM helpers for the legacy Studio interaction layer. */
export function byId(id: string): any {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Studio element #${id} is missing`);
  return element;
}

export function createElement(
  tagName: string,
  className = "",
  text?: string,
): any {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function createImage(source: string): HTMLImageElement {
  const image = document.createElement("img");
  image.src = assetPath(source);
  // Cards are mounted/unmounted by the virtual grid; eager loading avoids
  // Chromium leaving dynamically positioned images blank in file:// windows.
  image.loading = "eager";
  image.draggable = false;
  return image;
}

export function createToast(): (message: string) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;

  return (message) => {
    const toast = byId("toast");
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(timer);
    timer = setTimeout(() => toast.classList.remove("visible"), 3000);
  };
}
