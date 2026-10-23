/**
 * Copies text, falling back when the Clipboard API is unavailable (it needs a
 * secure context, which plain http:// tailnet addresses are not). Returns
 * "manual" when nothing worked and the user has to copy it themselves.
 */
export async function copyText(
  text: string,
): Promise<"clipboard" | "execCommand" | "manual"> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return "clipboard";
    }
  } catch {
    // blocked: try the next way
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  Object.assign(area.style, { position: "fixed", top: "0", opacity: "0" });
  document.body.append(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    // unsupported
  }
  area.remove();
  return copied ? "execCommand" : "manual";
}
