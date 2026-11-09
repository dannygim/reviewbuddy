import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BranchesResponse,
  ChangesResponse,
  SessionInfo,
} from "../shared/api";
import type { ServerEvent } from "../shared/events";
import { buildTree, findReadme } from "../shared/tree";
import {
  ApiError,
  endSession,
  fetchBranches,
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
  replaceChangesBase,
  replaceDoc,
  useChangesBase,
  useChangesOpen,
  useDocPath,
} from "./router";
import { threadStore, useThreads } from "./store";
import { Viewer } from "./Viewer";
import { useViewed } from "./viewed";

/** The changes against a branch (null: HEAD), or why there are none. */
type Listing = {
  base: string | null;
  changes: ChangesResponse;
  error: string | null;
};

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
  const urlBase = useChangesBase();
  // Where "Changes" goes back to from the files: the branch last compared with.
  const lastBase = useRef<string | null>(null);
  useEffect(() => {
    if (changesOpen) lastBase.current = urlBase;
  }, [changesOpen, urlBase]);
  const base = changesOpen ? urlBase : lastBase.current;
  const baseRef = useRef(base);
  const [listing, setListing] = useState<Listing | null>(null);
  const changes = listing?.changes ?? null;
  const [branches, setBranches] = useState<BranchesResponse>({
    local: [],
    remote: [],
  });
  const [viewed, setViewed] = useViewed(
    session?.id ?? "",
    listing?.base ?? null,
    changes?.files ?? [],
  );
  // A click in the changes tree: open that card and scroll to it.
  const [reveal, setReveal] = useState<{ path: string } | null>(null);
  // Where "Files" goes back to from the Changes view.
  const lastDoc = useRef<string | null>(null);
  useEffect(() => {
    if (docPath) lastDoc.current = docPath;
  }, [docPath]);

  // The changes against the branch compared with now, and the branches.
  const loadChanges = useCallback(async () => {
    const base = baseRef.current;
    const [listed, branches] = await Promise.all([
      fetchChanges(base).then(
        (changes) => ({ changes, error: null }),
        (error: unknown) => {
          // A branch that is gone or unrelated: shown in the Changes view,
          // where another one can be chosen.
          if (!base || !(error instanceof ApiError) || needsPin(error))
            throw error;
          return { changes: { git: true, files: [] }, error: error.message };
        },
      ),
      fetchBranches(),
    ]);
    if (base !== baseRef.current) return; // another branch was chosen meanwhile
    setListing({ base, ...listed });
    setBranches(branches);
  }, []);

  const refetch = useCallback(async () => {
    const [tree, threads] = await Promise.all([
      fetchTree(),
      fetchThreads(),
      loadChanges(),
    ]);
    setFiles(tree.files);
    threadStore.replaceAll(threads);
  }, [loadChanges]);

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

  // The first listing comes with load().
  useEffect(() => {
    if (baseRef.current === base) return;
    baseRef.current = base;
    void loadChanges().catch((error) => {
      if (needsPin(error)) lock();
    });
  }, [base, loadChanges, lock]);

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
          void loadChanges();
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
  }, [token, refetch, loadChanges, lock]);

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
                onClick={() => changesOpen || openChanges(lastBase.current)}
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
                listing &&
                (!listing.changes.git ? (
                  <p className="viewer-note">
                    This directory is not in a Git repository.
                  </p>
                ) : listing.base === base ? (
                  <ChangesView
                    key={base ?? ""}
                    base={base}
                    branches={branches}
                    onBase={replaceChangesBase}
                    error={listing.error}
                    files={listing.changes.files}
                    viewed={viewed}
                    onViewed={setViewed}
                    reveal={reveal}
                  />
                ) : (
                  <p className="viewer-note">Loading…</p>
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
