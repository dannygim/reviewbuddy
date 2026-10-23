import { timingSafeEqual } from "node:crypto";

// Access PIN (docs/adr/0007-access-pin.md): a new 6-digit PIN each start,
// entered once per browser, which then gets a cookie.

const AUTH_COOKIE = "reviewbuddy_auth";

const PIN_PATTERN = /^\d{6}$/;
// Largest multiple of 1,000,000 below 2^32, so `% 1_000_000` stays uniform.
const UNBIASED_LIMIT = 4_294_000_000;
const FAILURES_PER_MINUTE = 5;
const MAX_FAILURES = 20;

const randomUint32 = () => crypto.getRandomValues(new Uint32Array(1))[0]!;

export function newPin(random: () => number = randomUint32): string {
  let value: number;
  do value = random();
  while (value >= UNBIASED_LIMIT);
  return String(value % 1_000_000).padStart(6, "0");
}

export function formatPin(pin: string): string {
  return `${pin.slice(0, 3)} ${pin.slice(3)}`;
}

/** Cookies are shared by every port of a host, so each server gets its own name. */
export function authCookieName(port: number): string {
  return `${AUTH_COOKIE}_${port}`;
}

export function authCookie(name: string, token: string): string {
  return `${name}=${token}; HttpOnly; SameSite=Strict; Path=/`;
}

export type LoginResult =
  | { ok: true; token: string }
  | { ok: false; status: 400 | 401 | 403 | 429; error: string };

export class AccessGate {
  private readonly tokens = new Set<string>();
  private recentFailures: number[] = [];
  private failures = 0;

  constructor(
    readonly pin: string = newPin(),
    /** Called once when too many wrong PINs lock logins. */
    private readonly onLocked: () => void = () => {},
  ) {}

  get locked(): boolean {
    return this.failures >= MAX_FAILURES;
  }

  login(input: unknown, now: number = Date.now()): LoginResult {
    if (this.locked) {
      return {
        ok: false,
        status: 403,
        error:
          "Too many wrong PINs. Ask the host to restart reviewbuddy for a new PIN.",
      };
    }
    // Counted for everyone together: behind `tailscale serve`, all requests
    // come from 127.0.0.1.
    this.recentFailures = this.recentFailures.filter((t) => now - t < 60_000);
    if (this.recentFailures.length >= FAILURES_PER_MINUTE) {
      return {
        ok: false,
        status: 429,
        error: "Too many attempts. Try again in a minute.",
      };
    }
    const pin = typeof input === "string" ? input.replace(/\s/g, "") : "";
    if (!PIN_PATTERN.test(pin)) {
      return { ok: false, status: 400, error: "Enter the 6-digit PIN." };
    }
    if (!timingSafeEqual(Buffer.from(pin), Buffer.from(this.pin))) {
      this.recentFailures.push(now);
      this.failures++;
      if (this.locked) this.onLocked();
      return { ok: false, status: 401, error: "Wrong PIN." };
    }
    const token = Buffer.from(
      crypto.getRandomValues(new Uint8Array(32)),
    ).toString("hex");
    this.tokens.add(token);
    return { ok: true, token };
  }

  isAuthorized(cookieHeader: string | null, name: string): boolean {
    const token = new Bun.CookieMap(cookieHeader ?? "").get(name);
    return token !== null && this.tokens.has(token);
  }
}
