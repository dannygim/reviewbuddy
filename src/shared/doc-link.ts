const PREFIX = "#/doc/";

export function docPathFromHash(hash: string): string | null {
  if (!hash.startsWith(PREFIX)) return null;
  try {
    return (
      hash.slice(PREFIX.length).split("/").map(decodeURIComponent).join("/") ||
      null
    );
  } catch {
    return null; // malformed escape sequence
  }
}

export function hashForDocPath(path: string): string {
  return PREFIX + path.split("/").map(encodeURIComponent).join("/");
}
