import { useCallback, useEffect, useMemo, useState } from "react";
import type { SessionInfo } from "../shared/api";
import type { ServerEvent } from "../shared/events";
import { fetchSession, fetchThreads, fetchTree } from "./api";
import { type Reviewer, ReviewerContext } from "./context";
import { FileTree } from "./FileTree";
import { clientId, useNickname } from "./identity";
import { NicknameDialog } from "./NicknameDialog";
import { initials, presenceStore, uniquePeople, usePresence } from "./presence";
import { announce, announceView, connectRealtime } from "./realtime";
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
  const participants = usePresence();
  const docPath = useDocPath();

  const refetch = useCallback(async () => {
    const [tree, threads] = await Promise.all([fetchTree(), fetchThreads()]);
    setFiles(tree.files);
    threadStore.replaceAll(threads);
  }, []);

  useEffect(() => {
    fetchSession()
      .then(async (session) => {
        await refetch();
        setSession(session);
      })
      .catch(() => setError(true));
  }, [refetch]);

  useEffect(() => {
    if (!session) return;
    const onEvent = (event: ServerEvent) => {
      switch (event.type) {
        case "presence.changed":
          presenceStore.replaceAll(event.participants);
          break;
        case "thread.created":
        case "thread.updated":
          threadStore.upsert(event.thread);
          break;
        case "thread.deleted":
          threadStore.remove(event.threadId);
          break;
        case "tree.changed":
          void fetchTree().then((tree) => setFiles(tree.files));
          break;
      }
    };
    return connectRealtime({
      token: session.token,
      onEvent,
      onReconnect: () => void refetch(),
    });
  }, [session, refetch]);

  useEffect(() => {
    if (nickname) announce(nickname, clientId);
  }, [nickname]);

  useEffect(() => announceView(docPath), [docPath]);

  const openCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const thread of threads) {
      if (thread.status === "open") {
        counts.set(thread.path, (counts.get(thread.path) ?? 0) + 1);
      }
    }
    return counts;
  }, [threads]);

  const people = uniquePeople(participants);
  const others = people.filter((p) => p.clientId !== clientId);
  const viewers = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of uniquePeople(participants)) {
      if (p.clientId === clientId || !p.path) continue;
      map.set(p.path, [...(map.get(p.path) ?? []), p.nickname]);
    }
    return map;
  }, [participants]);

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
          <span className="presence">
            {nickname && (
              <button className="app-me" onClick={() => setRenaming(true)}>
                {nickname} (you)
              </button>
            )}
            {others.map((p) => (
              <span
                key={p.clientId}
                className="presence-person"
                title={p.path ?? ""}
              >
                <span className="avatar">{initials(p.nickname)}</span>
                {p.nickname}
              </span>
            ))}
          </span>
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
                viewers={viewers}
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
