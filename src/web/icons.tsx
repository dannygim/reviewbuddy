import type { ReactNode } from "react";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function SunIcon() {
  return (
    <Icon>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
    </Icon>
  );
}

export function MoonIcon() {
  return (
    <Icon>
      <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z" />
    </Icon>
  );
}

export function MonitorIcon() {
  return (
    <Icon>
      <rect x="1.5" y="2.5" width="13" height="9" rx="1" />
      <path d="M5.5 14h5M8 11.5V14" />
    </Icon>
  );
}

export function SidebarIcon() {
  return (
    <Icon>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
      <path d="M6 2.5v11" />
    </Icon>
  );
}

// Same speech bubble as the logo, fitted to 16x16.
export function CommentIcon({ filled }: { filled?: boolean }) {
  return (
    <Icon>
      <path
        d="M4.5 4h7a2.5 2.5 0 0 1 2.5 2.5v3a2.5 2.5 0 0 1-2.5 2.5H11v2.5L8.5 12h-4A2.5 2.5 0 0 1 2 9.5v-3A2.5 2.5 0 0 1 4.5 4z"
        fill={filled ? "currentColor" : "none"}
      />
    </Icon>
  );
}
