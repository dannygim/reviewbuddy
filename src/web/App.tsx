import { useEffect, useState } from "react";
import type { Health } from "../shared/api";
import { fetchHealth, fetchTree } from "./api";
import { FileTree } from "./FileTree";
import { openDoc, useDocPath } from "./router";
import { Viewer } from "./Viewer";

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [files, setFiles] = useState<string[] | null>(null);
  const [error, setError] = useState(false);
  const docPath = useDocPath();

  useEffect(() => {
    Promise.all([fetchHealth(), fetchTree()]).then(
      ([health, tree]) => {
        setHealth(health);
        setFiles(tree.files);
      },
      () => setError(true),
    );
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <strong>akapen</strong>
        <span className="app-root">
          {error
            ? "Cannot reach the akapen server."
            : (health?.root ?? "Connecting…")}
        </span>
      </header>
      <aside className="app-sidebar">
        {files && (
          <FileTree files={files} selected={docPath} onSelect={openDoc} />
        )}
      </aside>
      <main className="app-main">
        {docPath ? (
          <Viewer key={docPath} path={docPath} />
        ) : (
          <p className="viewer-note">Select a file to start reviewing.</p>
        )}
      </main>
    </div>
  );
}
