import mermaid from "mermaid";

/** Renders `.mermaid` elements in place; a diagram that fails keeps its source. */
export async function renderMermaid(nodes: HTMLElement[]): Promise<void> {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: dark ? "dark" : "default",
  });
  for (const node of nodes) {
    const source = node.textContent ?? "";
    try {
      await mermaid.run({ nodes: [node] });
    } catch {
      node.textContent = source;
      node.classList.add("mermaid-error");
    }
  }
}
