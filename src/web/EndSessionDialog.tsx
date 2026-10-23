import { useState } from "react";

type Props = {
  onCancel: () => void;
  onReview: () => void;
  onEnd: () => Promise<void>;
};

export function EndSessionDialog({ onCancel, onReview, onEnd }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog end-session"
        role="dialog"
        aria-label="End session"
      >
        <h2>End this session?</h2>
        <p>
          Everyone's view becomes read-only and no more comments can be added.
        </p>
        <p className="muted">
          Copy the prompt from Review first if you still need it. To keep
          everything, run <code>akapen export --format jsonl</code>.
        </p>
        {error && <p className="composer-error">{error}</p>}
        <div className="dialog-actions">
          <button onClick={onCancel}>Cancel</button>
          <button onClick={onReview}>Open Review</button>
          <button
            className="danger"
            data-action="confirm-end"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onEnd().catch((e: Error) => {
                setError(e.message);
                setBusy(false);
              });
            }}
          >
            End session
          </button>
        </div>
      </div>
    </div>
  );
}
