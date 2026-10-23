import { useState } from "react";

export const MAX_NICKNAME_LENGTH = 50;

type Props = {
  initial: string;
  onSave: (nickname: string) => void;
  onCancel?: () => void;
};

export function NicknameDialog({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial);
  const trimmed = name.trim();
  return (
    <div className="dialog-backdrop">
      <form
        className="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed) onSave(trimmed);
        }}
      >
        <h2>What should we call you?</h2>
        <p className="muted">Your nickname is shown next to your comments.</p>
        <input
          autoFocus
          name="nickname"
          value={name}
          maxLength={MAX_NICKNAME_LENGTH}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="dialog-actions">
          {onCancel && (
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="submit" className="primary" disabled={!trimmed}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
