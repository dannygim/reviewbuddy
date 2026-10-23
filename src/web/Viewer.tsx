import { useEffect, useState } from "react";
import type { FileView } from "../shared/api";
import { fetchFile, rawUrl } from "./api";
import { CodeView } from "./CodeView";
import { MarkdownPreview } from "./MarkdownPreview";

type State = { view: FileView } | { error: string } | null;
type Mode = "preview" | "source";

export function Viewer({ path }: { path: string }) {
  const [state, setState] = useState<State>(null);
  const [mode, setMode] = useState<Mode>("preview");

  useEffect(() => {
    let cancelled = false;
    setState(null);
    fetchFile(path).then(
      (view) => cancelled || setState({ view }),
      (error: Error) => cancelled || setState({ error: error.message }),
    );
    return () => {
      cancelled = true;
    };
  }, [path]);

  const isMarkdown = state && "view" in state && state.view.kind === "markdown";
  return (
    <section className="viewer">
      <header className="viewer-header">
        <span>{path}</span>
        {isMarkdown && <Tabs mode={mode} onChange={setMode} />}
      </header>
      <ViewerBody state={state} mode={mode} />
    </section>
  );
}

function Tabs({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="viewer-tabs" role="tablist">
      {(["preview", "source"] as const).map((m) => (
        <button
          key={m}
          role="tab"
          data-mode={m}
          aria-selected={mode === m}
          onClick={() => onChange(m)}
        >
          {m === "preview" ? "Preview" : "Source"}
        </button>
      ))}
    </div>
  );
}

function ViewerBody({ state, mode }: { state: State; mode: Mode }) {
  if (!state) return <p className="viewer-note">Loading…</p>;
  if ("error" in state) return <p className="viewer-note">{state.error}</p>;
  const { view } = state;
  switch (view.kind) {
    case "image":
      return <img className="viewer-image" src={rawUrl(view.path)} alt="" />;
    case "binary":
      return <p className="viewer-note">Binary file not shown.</p>;
    case "markdown":
      return mode === "preview" ? (
        <MarkdownPreview html={view.previewHtml} />
      ) : (
        <CodeView path={view.path} lineHtml={view.lineHtml} />
      );
    default:
      return (
        <>
          {view.kind === "large" && (
            <p className="viewer-note">
              This file is large, so it is shown without highlighting.
            </p>
          )}
          <CodeView path={view.path} lineHtml={view.lineHtml} />
        </>
      );
  }
}
