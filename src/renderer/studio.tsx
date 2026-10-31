import {
  createElement,
  useEffect,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import studioMarkup from "./studio-template.html?raw";
import "../../original-ui/index-BjTCKBy6.css";
import "../../studio.css";

function parseStyle(value: string): CSSProperties {
  const style: Record<string, string> = {};
  for (const declaration of value.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    const property = declaration.slice(0, separator).trim();
    const name = property.startsWith("--")
      ? property
      : property.replace(/-([a-z])/g, (_, letter: string) =>
          letter.toUpperCase(),
        );
    style[name] = declaration.slice(separator + 1).trim();
  }
  return style as CSSProperties;
}

const attributeAliases: Record<string, string> = {
  class: "className",
  for: "htmlFor",
  maxlength: "maxLength",
  tabindex: "tabIndex",
  autofocus: "autoFocus",
  readonly: "readOnly",
};

function toReactNode(node: Node, key: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (!(node instanceof Element)) return null;

  const props: Record<string, unknown> = { key };
  for (const attribute of Array.from(node.attributes)) {
    const name =
      attributeAliases[attribute.name] ??
      attribute.name.replace(/-([a-z])/g, (_, letter: string) =>
        letter.toUpperCase(),
      );
    if (name === "style") {
      props.style = parseStyle(attribute.value);
    } else if (
      [
        "hidden",
        "disabled",
        "checked",
        "multiple",
        "required",
        "open",
        "draggable",
      ].includes(name)
    ) {
      props[name] = attribute.value !== "false";
    } else if (
      attribute.name === "src" &&
      /^(assets|original-ui)\//.test(attribute.value)
    ) {
      props[name] = `../${attribute.value}`;
    } else {
      props[name] = attribute.value;
    }
  }

  const children = Array.from(node.childNodes, (child, index) =>
    toReactNode(child, index),
  );
  return createElement(node.tagName.toLowerCase(), props, ...children);
}

const studioBody = new DOMParser().parseFromString(
  studioMarkup,
  "text/html",
).body;
const studioNodes = Array.from(studioBody.childNodes, toReactNode);

function StudioApp() {
  useEffect(() => {
    void import("./studio-controller");
  }, []);

  return <div>{studioNodes}</div>;
}

createRoot(document.getElementById("root")!).render(<StudioApp />);
