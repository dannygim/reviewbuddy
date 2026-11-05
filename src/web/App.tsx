import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangesResponse, SessionInfo } from "../shared/api";
import type { ServerEvent } from "../shared/events";
import { buildTree, findReadme } from "../shared/tree";
import {
  endSession,
  fetchChanges,
  fetchSession,
  fetchThreads,
  fetchTree,
  needsPin,
} from "./api";
import { ChangesTree } from "./ChangesTree";
import { ChangesView } from "./ChangesView";
import { type Reviewer, ReviewerContext } from "./context";
import { DisplayModeMenu } from "./DisplayModeMenu";
import { EndSessionDialog } from "./EndSessionDialog";
import { FileTree, type ThreadCounts } from "./FileTree";
import { bumpFileVersion } from "./fileVersions";
import { SidebarIcon } from "./icons";
import { clientId, useNickname } from "./identity";
import { LoginDialog } from "./LoginDialog";
import { NicknameDialog } from "./NicknameDialog";
import { usePaneOpen } from "./panes";
import { initials, presenceStore, uniquePeople, usePresence } from "./presence";
import { announce, announceView, connectRealtime } from "./realtime";
import { ReviewPanel } from "./ReviewPanel";
import {
  openChanges,
  openDoc,
  openFiles,
  replaceDoc,
  useChangesOpen,
  useDocPath,
} from "./router";
import { threadStore, useThreads } from "./store";
import { Viewer } from "./Viewer";
import { useViewed } from "./viewed";

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
  const [treeOpen, setTreeOpen] = usePaneOpen("fileTree");
  const threads = useThreads();
  const participants = usePresence();
  const docPath = useDocPath();
  const changesOpen = useChangesOpen();
  const [changes, setChanges] = useState<ChangesResponse | null>(null);
  const [viewed, setViewed] = useViewed(
    session?.id ?? "",
    changes?.files ?? [],
  );
  // A click in the changes tree: open that card and scroll to it.
  const [reveal, setReveal] = useState<{ path: string } | null>(null);
  // Where "Files" goes back to from the Changes view.
  const lastDoc = useRef<string | null>(null);
  useEffect(() => {
    if (docPath) lastDoc.current = docPath;
  }, [docPath]);

  const refetch = useCallback(async () => {
    const [tree, threads, changes] = await Promise.all([
      fetchTree(),
      fetchThreads(),
      fetchChanges(),
    ]);
    setFiles(tree.files);
    threadStore.replaceAll(threads);
    setChanges(changes);
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
        case "changes.changed":
          void fetchChanges().then(setChanges);
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

  // With no file open, show the root README.md if there is one.
  const rootReadme = useMemo(
    () => (files ? findReadme(buildTree(files)) : null),
    [files],
  );
  useEffect(() => {
    if (!docPath && !changesOpen && rootReadme) replaceDoc(rootReadme);
  }, [docPath, changesOpen, rootReadme]);

  const threadCounts = useMemo(() => {
    const counts = new Map<string, ThreadCounts>();
    for (const thread of threads) {
      const entry = counts.get(thread.path) ?? { open: 0, resolved: 0 };
      entry[thread.status === "open" ? "open" : "resolved"]++;
      counts.set(thread.path, entry);
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
          <button
            className="app-mode"
            data-action="file-tree"
            aria-label="File tree"
            aria-pressed={treeOpen}
            onClick={() => setTreeOpen(!treeOpen)}
          >
            <SidebarIcon />
          </button>
          <strong>reviewbuddy</strong>
          <span className="app-root" title={session?.root}>
            {error
              ? "Cannot reach the reviewbuddy server."
              : locked
                ? "Enter the PIN to join."
                : (session?.rootDisplay ?? "Connecting…")}
          </span>
          {session && (
            <span className="app-session muted">session {session.id}</span>
          )}
          {session && changes?.git && (
            <span className="viewer-tabs app-switch" role="tablist">
              <button
                role="tab"
                data-action="files"
                aria-selected={!changesOpen}
                onClick={() => changesOpen && openFiles(lastDoc.current)}
              >
                Files
              </button>
              <button
                role="tab"
                data-action="changes"
                aria-selected={changesOpen}
                onClick={() => changesOpen || openChanges()}
              >
                Changes {changes.files.length}
              </button>
            </span>
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
          <DisplayModeMenu />
        </header>
        {session?.readOnly && (
          <div className="banner">
            This session has ended. Comments are read-only.
          </div>
        )}
        <div className={treeOpen ? "app-body" : "app-body tree-closed"}>
          {/* Hidden, not removed, so expanded directories stay expanded. */}
          <aside className="app-sidebar" hidden={!treeOpen}>
            {files && (
              <div hidden={changesOpen}>
                <FileTree
                  files={files}
                  selected={docPath}
                  threads={threadCounts}
                  viewers={viewers}
                  changed={changed}
                  onSelect={openDoc}
                />
              </div>
            )}
            {changesOpen && changes && (
              <ChangesTree
                files={changes.files}
                viewed={viewed}
                onSelect={(path) => setReveal({ path })}
              />
            )}
          </aside>
          <main className="app-main">
            {changesOpen
              ? session &&
                changes &&
                (changes.git ? (
                  <ChangesView
                    files={changes.files}
                    viewed={viewed}
                    onViewed={setViewed}
                    reveal={reveal}
                  />
                ) : (
                  <p className="viewer-note">
                    This directory is not in a Git repository.
                  </p>
                ))
              : docPath
                ? // Loaded only once the PIN was accepted.
                  session && <Viewer key={docPath} path={docPath} />
                : files &&
                  !rootReadme && (
                    <p className="viewer-note">
                      Select a file to start reviewing.
                    </p>
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
