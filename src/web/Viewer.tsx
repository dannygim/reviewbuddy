import { useEffect, useState } from "react";
import type { FileView } from "../shared/api";
import { fetchFile, rawUrl } from "./api";

type State = { view: FileView } | { error: string } | null;

export function Viewer({ path }: { path: string }) {
  const [state, setState] = useState<State>(null);

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

  return (
    <section className="viewer">
      <header className="viewer-header">{path}</header>
      <ViewerBody state={state} />
    </section>
  );
}

function ViewerBody({ state }: { state: State }) {
  if (!state) return <p className="viewer-note">Loading…</p>;
  if ("error" in state) return <p className="viewer-note">{state.error}</p>;
  const { view } = state;
  switch (view.kind) {
    case "image":
      return <img className="viewer-image" src={rawUrl(view.path)} alt="" />;
    case "binary":
      return <p className="viewer-note">Binary file not shown.</p>;
    default:
      return (
        <>
          {view.kind === "large" && (
            <p className="viewer-note">
              This file is large, so it is shown without highlighting.
            </p>
          )}
          <CodeView lineHtml={view.lineHtml} />
        </>
      );
  }
}

function CodeView({ lineHtml }: { lineHtml: string[] }) {
  return (
    <table className="code">
      <tbody>
        {lineHtml.map((html, i) => (
          <tr key={i} data-line={i + 1}>
            <td className="code-ln">{i + 1}</td>
            {/* Server-rendered: Shiki tokens with escaped text. */}
            <td
              className="code-src"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </tr>
        ))}
      </tbody>
    </table>
  );
}
