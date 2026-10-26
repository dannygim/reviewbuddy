import mermaid from "mermaid";
import type { ColorScheme } from "./displayMode";

// mermaid.initialize is global, so renders run one at a time to keep two
// themes from mixing when the scheme is switched quickly.
let queue: Promise<void> = Promise.resolve();

/**
 * Renders `.mermaid` elements in place in the given scheme, and redraws ones
 * already drawn; a diagram that fails keeps its source.
 */
export function renderMermaid(
  nodes: HTMLElement[],
  scheme: ColorScheme,
): Promise<void> {
  const run = queue.then(() => draw(nodes, scheme));
  queue = run.catch(() => {});
  return run;
}

async function draw(nodes: HTMLElement[], scheme: ColorScheme): Promise<void> {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: scheme === "dark" ? "dark" : "default",
  });
  for (const node of nodes) {
    if (!node.isConnected) continue;
    // The SVG replaces the source, so keep it to redraw in another scheme.
    node.dataset.source ??= node.textContent ?? "";
    const source = node.dataset.source;
    node.removeAttribute("data-processed");
    node.classList.remove("mermaid-error");
    node.textContent = source;
    try {
      await mermaid.run({ nodes: [node] });
    } catch {
      node.textContent = source;
      node.classList.add("mermaid-error");
    }
  }
}
