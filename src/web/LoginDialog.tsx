import { useState } from "react";
import { login } from "./api";
import { MAX_NICKNAME_LENGTH } from "./NicknameDialog";

type Props = {
  initialNickname: string;
  /** Called once the PIN was accepted. */
  onJoin: (nickname: string) => void;
};

export function LoginDialog({ initialNickname, onJoin }: Props) {
  const [name, setName] = useState(initialNickname);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();
  const digits = pin.replace(/\s/g, "");
  return (
    <div className="dialog-backdrop">
      <form
        className="dialog"
        data-dialog="login"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await login(digits);
            onJoin(trimmed);
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        <h2>Join the review</h2>
        <p className="muted">
          Enter your nickname and the 6-digit PIN shown where akapen was
          started.
        </p>
        <label>
          Nickname
          <input
            autoFocus={!initialNickname}
            name="nickname"
            value={name}
            maxLength={MAX_NICKNAME_LENGTH}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          PIN
          <input
            autoFocus={Boolean(initialNickname)}
            name="pin"
            value={pin}
            inputMode="numeric"
            autoComplete="off"
            maxLength={7}
            placeholder="123 456"
            onChange={(event) => setPin(event.target.value)}
          />
        </label>
        {error && <p className="dialog-error">{error}</p>}
        <div className="dialog-actions">
          <button
            type="submit"
            className="primary"
            disabled={!trimmed || digits.length !== 6 || busy}
          >
            Join
          </button>
        </div>
      </form>
    </div>
  );
}
