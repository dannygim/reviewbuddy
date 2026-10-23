import type { ClientMessage, ServerEvent } from "../shared/events";

type Options = {
  token: string;
  onEvent: (event: ServerEvent) => void;
  /** Called after a reconnect, to refetch what was missed while offline. */
  onReconnect: () => void;
  /** Called when the connection is lost (the server may have restarted). */
  onDisconnect: () => void;
};

const MAX_DELAY_MS = 10_000;

let socket: WebSocket | null = null;
let hello: ClientMessage | null = null;
let view: ClientMessage = { type: "view", path: null };

function send(message: ClientMessage | null): void {
  if (message && socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

/** Connects to /ws and keeps reconnecting with a growing delay. Returns a disconnect function. */
export function connectRealtime(options: Options): () => void {
  let delay = 1000;
  let connected = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const open = () => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(
      `${protocol}//${location.host}/ws?token=${encodeURIComponent(options.token)}`,
    );
    socket = ws;
    ws.onopen = () => {
      delay = 1000;
      send(hello);
      send(view);
      if (connected) options.onReconnect();
      connected = true;
    };
    ws.onmessage = (message) =>
      options.onEvent(JSON.parse(String(message.data)) as ServerEvent);
    ws.onclose = () => {
      if (socket === ws) socket = null;
      if (stopped) return;
      options.onDisconnect();
      timer = setTimeout(open, delay);
      delay = Math.min(delay * 2, MAX_DELAY_MS);
    };
  };

  open();
  return () => {
    stopped = true;
    clearTimeout(timer);
    socket?.close();
  };
}

/** Tells the others who we are (sent again after each reconnect). */
export function announce(nickname: string, clientId: string): void {
  hello = { type: "hello", nickname, clientId };
  send(hello);
}

/** Tells the others which file we have open. */
export function announceView(path: string | null): void {
  view = { type: "view", path };
  send(view);
}
