import { type KeyboardEvent, useState } from "react";

type Props = {
  submitLabel: string;
  initial?: string;
  placeholder?: string;
  onSubmit: (body: string) => Promise<void>;
  onCancel: () => void;
};

export function Composer(props: Props) {
  const { submitLabel, initial = "", placeholder, onSubmit, onCancel } = props;
  const [body, setBody] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(body);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    } else if (event.key === "Escape") {
      onCancel();
    }
  };

  return (
    <div className="composer">
      <textarea
        autoFocus
        rows={3}
        value={body}
        placeholder={placeholder ?? "Leave a comment"}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {error && <p className="composer-error">{error}</p>}
      <div className="composer-actions">
        <button type="button" data-action="cancel" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          data-action="submit"
          disabled={busy || !body.trim()}
          onClick={() => void submit()}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
