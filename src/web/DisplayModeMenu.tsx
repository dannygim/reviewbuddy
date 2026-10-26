import { type KeyboardEvent, type ReactNode, useRef } from "react";
import { type DisplayMode, useDisplayMode } from "./displayMode";
import { MonitorIcon, MoonIcon, SunIcon } from "./icons";

type Item = { mode: DisplayMode; label: string; icon: ReactNode };

const SYSTEM: Item = { mode: "system", label: "System", icon: <MonitorIcon /> };

const MODES: Item[] = [
  { mode: "light", label: "Light", icon: <SunIcon /> },
  { mode: "dark", label: "Dark", icon: <MoonIcon /> },
  SYSTEM,
];

export function DisplayModeMenu() {
  const [current, setCurrent] = useDisplayMode();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const active = MODES.find((m) => m.mode === current) ?? SYSTEM;

  const items = () =>
    Array.from(menu.current?.querySelectorAll<HTMLElement>("button") ?? []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    list[(at + step + list.length) % list.length]?.focus();
  };

  const choose = (mode: DisplayMode) => {
    setCurrent(mode);
    menu.current?.hidePopover();
    button.current?.focus();
  };

  return (
    <>
      <button
        ref={button}
        className="app-mode"
        data-action="display-mode"
        popoverTarget="display-mode-menu"
        aria-haspopup="menu"
        aria-label={`Display mode: ${active.label}`}
      >
        {active.icon}
      </button>
      <div
        ref={menu}
        id="display-mode-menu"
        className="mode-menu"
        popover="auto"
        role="menu"
        aria-label="Display mode"
        onKeyDown={onKeyDown}
        onToggle={(event) => {
          if (event.newState !== "open") {
            // Escape: put focus back unless a light dismiss moved it elsewhere.
            const at = document.activeElement;
            if (!at || at === document.body || menu.current?.contains(at)) {
              button.current?.focus();
            }
            return;
          }
          items()
            .find((item) => item.getAttribute("aria-checked") === "true")
            ?.focus();
        }}
      >
        {MODES.map(({ mode, label }) => (
          <button
            key={mode}
            type="button"
            role="menuitemradio"
            aria-checked={mode === current}
            data-display-mode={mode}
            onClick={() => choose(mode)}
          >
            <span className="mode-check">{mode === current ? "✓" : ""}</span>
            {label}
          </button>
        ))}
      </div>
    </>
  );
}
