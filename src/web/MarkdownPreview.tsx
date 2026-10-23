import DOMPurify from "dompurify";
import { type MouseEvent, useEffect, useMemo, useRef } from "react";

export function MarkdownPreview({ html }: { html: string }) {
  const ref = useRef<HTMLElement>(null);
  const clean = useMemo(
    () => DOMPurify.sanitize(html, { ADD_ATTR: ["target"] }),
    [html],
  );

  // Mermaid is large, so it is only loaded for documents that need it.
  useEffect(() => {
    const nodes = [
      ...(ref.current?.querySelectorAll<HTMLElement>(".mermaid") ?? []),
    ];
    if (nodes.length > 0) {
      void import("./mermaid").then(({ renderMermaid }) =>
        renderMermaid(nodes),
      );
    }
  }, [clean]);

  // Plain "#fragment" links would replace the "#/doc/<path>" route.
  const onClick = (event: MouseEvent) => {
    const href = (event.target as Element).closest("a")?.getAttribute("href");
    if (href?.startsWith("#") && !href.startsWith("#/doc/")) {
      event.preventDefault();
    }
  };

  return (
    <article
      ref={ref}
      className="markdown"
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
