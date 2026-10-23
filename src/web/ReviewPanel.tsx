import { useMemo, useState } from "react";
import {
  DEFAULT_PROMPT_OPTIONS,
  formatPrompt,
  sortThreads,
} from "../prompt/format";
import type { Thread } from "../shared/api";
import { requestPrompt } from "./api";
import { copyText } from "./clipboard";
import { useReviewer } from "./context";
import { openDoc } from "./router";
import { threadStore, useThreads } from "./store";
import { lineRange } from "./Thread";

type Filter = "open" | "resolved" | "sent";

const FILTERS: [Filter, string, (t: Thread) => boolean][] = [
  ["open", "Open", (t) => t.status === "open"],
  ["resolved", "Resolved", (t) => t.status === "resolved"],
  ["sent", "Sent", (t) => t.exportedAt !== null],
];

/** All threads of the session, with prompt generation for the selected ones. */
export function ReviewPanel({ onClose }: { onClose: () => void }) {
  const reviewer = useReviewer();
  const threads = useThreads();
  const sorted = useMemo(() => sortThreads(threads), [threads]);
  const [filter, setFilter] = useState<Filter>("open");
  // Opening the panel selects every open thread.
  const [selected, setSelected] = useState(
    () => new Set(threads.filter((t) => t.status === "open").map((t) => t.id)),
  );
  const [resolveCopied, setResolveCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [manual, setManual] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const matches = FILTERS.find(([key]) => key === filter)![2];
  const visible = sorted.filter(matches);
  const chosen = sorted.filter((t) => selected.has(t.id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const copy = async () => {
    setBusy(true);
    setNotice(null);
    try {
      let text: string;
      if (reviewer.readOnly) {
        // An ended session cannot record exports; format in the browser.
        text = formatPrompt(chosen, DEFAULT_PROMPT_OPTIONS);
      } else {
        const res = await requestPrompt(
          chosen.map((t) => t.id),
          resolveCopied,
          reviewer.nickname,
        );
        for (const thread of res.threads) threadStore.upsert(thread);
        text = res.text;
      }
      const how = await copyText(text);
      if (how === "manual") setManual(text);
      else
        setNotice(
          `Copied ${chosen.length} thread${chosen.length === 1 ? "" : "s"}.`,
        );
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="review-panel" aria-label="Review">
      <header className="review-header">
        <strong>Review</strong>
        <button data-action="close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      <div className="viewer-tabs review-filters" role="tablist">
        {FILTERS.map(([key, label, test]) => (
          <button
            key={key}
            role="tab"
            data-filter={key}
            aria-selected={filter === key}
            onClick={() => setFilter(key)}
          >
            {label} ({threads.filter(test).length})
          </button>
        ))}
      </div>
      <ul className="review-list">
        {visible.length === 0 && <li className="muted">No threads.</li>}
        {visible.map((t) => (
          <li key={t.id} data-thread-id={t.id}>
            <input
              type="checkbox"
              aria-label={`Include ${t.path} ${lineRange(t)}`}
              checked={selected.has(t.id)}
              onChange={() => toggle(t.id)}
            />
            <button className="review-item" onClick={() => openDoc(t.path)}>
              <span className="review-where">
                {t.path}:
                {t.startLine === t.endLine
                  ? t.startLine
                  : `${t.startLine}-${t.endLine}`}
                {t.status === "resolved" && (
                  <span className="label">Resolved</span>
                )}
                {t.outdated && <span className="label">Outdated</span>}
                {t.exportedAt && <span className="label">Sent</span>}
              </span>
              <span className="muted">
                {t.comments[0]?.author}: {t.comments[0]?.body}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <footer className="review-footer">
        {notice && <p className="muted">{notice}</p>}
        {!reviewer.readOnly && (
          <label>
            <input
              type="checkbox"
              checked={resolveCopied}
              onChange={(e) => setResolveCopied(e.target.checked)}
            />{" "}
            Resolve copied threads
          </label>
        )}
        <button
          className="primary"
          data-action="copy-prompt"
          disabled={busy || chosen.length === 0}
          onClick={() => void copy()}
        >
          Copy prompt ({chosen.length})
        </button>
      </footer>
      {manual !== null && (
        <div className="dialog-backdrop">
          <div className="dialog dialog-wide manual-copy">
            <h2>Copy the prompt</h2>
            <p className="muted">
              The browser did not allow copying. Press Cmd/Ctrl+C to copy the
              selected text.
            </p>
            <textarea
              readOnly
              rows={16}
              value={manual}
              ref={(el) => el?.select()}
            />
            <div className="dialog-actions">
              <button className="primary" onClick={() => setManual(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
