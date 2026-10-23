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
