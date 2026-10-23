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
