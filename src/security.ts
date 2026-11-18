const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Host header allowlist against DNS rebinding: IP literals, localhost,
 * Tailscale (*.ts.net) names, and names configured in server.allowed_hosts.
 */
export function isAllowedHost(
  host: string | null,
  allowedHosts: string[],
): boolean {
  if (!host) return false;
  if (host.startsWith("[")) return true; // IPv6 literal
  const name = host.replace(/:\d+$/, "").toLowerCase();
  return (
    IPV4.test(name) ||
    name === "localhost" ||
    name.endsWith(".ts.net") ||
    allowedHosts.some((allowed) => allowed.toLowerCase() === name)
  );
}

const THIS_MACHINE = new Set(["localhost", "[::1]", "0.0.0.0", "[::]"]);
const FORWARDING_HEADERS = ["x-forwarded-for", "x-forwarded-host", "forwarded"];

function isLoopbackV4(address: string): boolean {
  const parts = address.split(".");
  return (
    parts.length === 4 &&
    parts[0] === "127" &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}

/**
 * The owner (docs/adr/0009-owner-by-connection.md): a browser on this
 * machine connecting directly, from a loopback address to a Host naming this
 * machine, with no proxy's forwarding headers. tailscale serve also connects
 * from 127.0.0.1, but keeps the ts.net Host and adds X-Forwarded-*.
 */
export function isOwnerRequest(
  address: string | null | undefined,
  headers: Headers,
): boolean {
  const loopback =
    !!address &&
    (address === "::1" || isLoopbackV4(address.replace(/^::ffff:/, "")));
  const name = headers.get("host")?.replace(/:\d+$/, "").toLowerCase();
  return (
    loopback &&
    !!name &&
    (THIS_MACHINE.has(name) || isLoopbackV4(name)) &&
    !FORWARDING_HEADERS.some((header) => headers.has(header))
  );
}

/**
 * Origin check for WebSocket upgrades (against cross-site WebSocket
 * hijacking): same host as the request, or a Tailscale (*.ts.net) name.
 * Non-browser clients send no Origin; the session token still applies.
 */
export function isAllowedOrigin(
  origin: string | null,
  host: string | null,
): boolean {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.host === host || url.hostname.endsWith(".ts.net");
  } catch {
    return false;
  }
}
