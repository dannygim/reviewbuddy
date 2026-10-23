import { useCallback, useEffect, useMemo, useState } from "react";
import type { SessionInfo } from "../shared/api";
import type { ServerEvent } from "../shared/events";
import {
  endSession,
  fetchSession,
  fetchThreads,
  fetchTree,
  needsPin,
} from "./api";
import { type Reviewer, ReviewerContext } from "./context";
import { EndSessionDialog } from "./EndSessionDialog";
import { FileTree } from "./FileTree";
import { bumpFileVersion } from "./fileVersions";
import { clientId, useNickname } from "./identity";
import { LoginDialog } from "./LoginDialog";
import { NicknameDialog } from "./NicknameDialog";
import { initials, presenceStore, uniquePeople, usePresence } from "./presence";
import { announce, announceView, connectRealtime } from "./realtime";
import { ReviewPanel } from "./ReviewPanel";
import { openDoc, useDocPath } from "./router";
import { threadStore, useThreads } from "./store";
import { Viewer } from "./Viewer";

export function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [files, setFiles] = useState<string[] | null>(null);
  const [error, setError] = useState(false);
  const [locked, setLocked] = useState(false);
  const [nickname, setNickname] = useNickname();
  const [renaming, setRenaming] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [ending, setEnding] = useState(false);
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set());
  const threads = useThreads();
  const participants = usePresence();
  const docPath = useDocPath();

  const refetch = useCallback(async () => {
    const [tree, threads] = await Promise.all([fetchTree(), fetchThreads()]);
    setFiles(tree.files);
    threadStore.replaceAll(threads);
  }, []);

  // A 401 asks for the PIN; dropping the session also stops the WebSocket.
  const lock = useCallback(() => {
    setSession(null);
    setLocked(true);
  }, []);

  const load = useCallback(async () => {
    try {
      const session = await fetchSession();
      await refetch();
      setLocked(false);
      setSession(session);
    } catch (error) {
      if (needsPin(error)) lock();
      else setError(true);
    }
  }, [refetch, lock]);

  useEffect(() => {
    void load();
  }, [load]);

  const token = session?.token;
  useEffect(() => {
    if (!token) return;
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
        case "file.changed": {
          const { path } = event;
          bumpFileVersion(path);
          setChanged((prev) => new Set(prev).add(path));
          setTimeout(
            () =>
              setChanged((prev) => {
                const next = new Set(prev);
                next.delete(path);
                return next;
              }),
            3000,
          );
          break;
        }
        case "tree.changed":
          void fetchTree().then((tree) => setFiles(tree.files));
          break;
        case "session.ended":
          setSession((s) => s && { ...s, status: "ended", readOnly: true });
          break;
      }
    };
    return connectRealtime({
      token,
      onEvent,
      onReconnect: () => void refetch(),
      // After a restart the old cookie is unknown: ask for the new PIN.
      onDisconnect: () =>
        void fetchSession().catch((error) => {
          if (needsPin(error)) lock();
        }),
    });
  }, [token, refetch, lock]);

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
          <span className="app-root" title={session?.root}>
            {error
              ? "Cannot reach the akapen server."
              : locked
                ? "Enter the PIN to join."
                : (session?.rootDisplay ?? "Connecting…")}
          </span>
          {session && (
            <span className="app-session muted">session {session.id}</span>
          )}
          <span className="app-spacer" />
          {session && (
            <button
              className="app-review"
              data-action="review"
              aria-pressed={reviewing}
              onClick={() => setReviewing(!reviewing)}
            >
              Review ({threads.filter((t) => t.status === "open").length})
            </button>
          )}
          {session && !session.readOnly && (
            <button
              className="app-review"
              data-action="end-session"
              onClick={() => setEnding(true)}
            >
              End
            </button>
          )}
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
                changed={changed}
                onSelect={openDoc}
              />
            )}
          </aside>
          <main className="app-main">
            {docPath ? (
              // Loaded only once the PIN was accepted.
              session && <Viewer key={docPath} path={docPath} />
            ) : (
              <p className="viewer-note">Select a file to start reviewing.</p>
            )}
          </main>
          {reviewing && session && (
            <ReviewPanel
              session={session}
              onClose={() => setReviewing(false)}
            />
          )}
        </div>
      </div>
      {ending && (
        <EndSessionDialog
          onCancel={() => setEnding(false)}
          onReview={() => {
            setEnding(false);
            setReviewing(true);
          }}
          onEnd={async () => {
            setSession(await endSession());
            setEnding(false);
          }}
        />
      )}
      {locked && (
        <LoginDialog
          initialNickname={nickname ?? ""}
          onJoin={(name) => {
            setNickname(name);
            void load();
          }}
        />
      )}
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
