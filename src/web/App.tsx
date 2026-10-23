import { useEffect, useMemo, useState } from "react";
import type { SessionInfo } from "../shared/api";
import { fetchSession, fetchThreads, fetchTree } from "./api";
import { type Reviewer, ReviewerContext } from "./context";
import { FileTree } from "./FileTree";
import { clientId, useNickname } from "./identity";
import { NicknameDialog } from "./NicknameDialog";
import { openDoc, useDocPath } from "./router";
import { threadStore, useThreads } from "./store";
import { Viewer } from "./Viewer";

export function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [files, setFiles] = useState<string[] | null>(null);
  const [error, setError] = useState(false);
  const [nickname, setNickname] = useNickname();
  const [renaming, setRenaming] = useState(false);
  const threads = useThreads();
  const docPath = useDocPath();

  useEffect(() => {
    Promise.all([fetchSession(), fetchTree(), fetchThreads()]).then(
      ([session, tree, threads]) => {
        setSession(session);
        setFiles(tree.files);
        threadStore.replaceAll(threads);
      },
      () => setError(true),
    );
  }, []);

  const openCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const thread of threads) {
      if (thread.status === "open") {
        counts.set(thread.path, (counts.get(thread.path) ?? 0) + 1);
      }
    }
    return counts;
  }, [threads]);

  const reviewer = useMemo<Reviewer>(
    () => ({
      nickname: nickname ?? "",
      clientId,
      readOnly: session?.readOnly ?? true,
    }),
    [nickname, session],
  );
  const askNickname = session !== null && !session.readOnly && !nickname;

  return (
    <ReviewerContext.Provider value={reviewer}>
      <div className="app">
        <header className="app-header">
          <strong>akapen</strong>
          <span className="app-root">
            {error
              ? "Cannot reach the akapen server."
              : (session?.root ?? "Connecting…")}
          </span>
          {session && <span className="muted">session {session.id}</span>}
          <span className="app-spacer" />
          {nickname && (
            <button className="app-me" onClick={() => setRenaming(true)}>
              {nickname} (you)
            </button>
          )}
        </header>
        {session?.readOnly && (
          <div className="banner">
            This session has ended. Comments are read-only.
          </div>
        )}
        <div className="app-body">
          <aside className="app-sidebar">
            {files && (
              <FileTree
                files={files}
                selected={docPath}
                badges={openCounts}
                onSelect={openDoc}
              />
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
      </div>
      {(askNickname || renaming) && (
        <NicknameDialog
          initial={nickname ?? ""}
          onSave={(name) => {
            setNickname(name);
            setRenaming(false);
          }}
          onCancel={renaming ? () => setRenaming(false) : undefined}
        />
      )}
    </ReviewerContext.Provider>
  );
}
