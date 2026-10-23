import type { ClientMessage, Participant, ServerEvent } from "../shared/events";

export type SocketData = {
  clientId: string | null;
  nickname: string | null;
  path: string | null;
};

type Socket = Bun.ServerWebSocket<SocketData>;

const TOPIC = "review";
const MAX_FIELD = 4096;

/** Tracks connected browsers and broadcasts events to all of them. */
export class Hub {
  private readonly sockets = new Set<Socket>();
  private server: Bun.Server<SocketData> | null = null;

  attach(server: Bun.Server<SocketData>): void {
    this.server = server;
  }

  publish(event: ServerEvent): void {
    // Server.publish reaches every subscriber, including the sender.
    this.server?.publish(TOPIC, JSON.stringify(event), false);
  }

  readonly handlers = {
    data: {} as SocketData,
    open: (ws: Socket) => {
      this.sockets.add(ws);
      ws.subscribe(TOPIC);
    },
    message: (ws: Socket, raw: string | Buffer) => {
      const message = parse(String(raw));
      if (message?.type === "hello") {
        ws.data.clientId = message.clientId;
        ws.data.nickname = message.nickname;
      } else if (message?.type === "view") {
        ws.data.path = message.path;
      } else {
        return;
      }
      this.publishPresence();
    },
    close: (ws: Socket) => {
      this.sockets.delete(ws);
      this.publishPresence();
    },
  };

  participants(): Participant[] {
    const result: Participant[] = [];
    for (const { data } of this.sockets) {
      if (data.clientId && data.nickname) {
        result.push({
          clientId: data.clientId,
          nickname: data.nickname,
          path: data.path,
        });
      }
    }
    return result;
  }

  private publishPresence(): void {
    this.publish({
      type: "presence.changed",
      participants: this.participants(),
    });
  }
}

const isText = (value: unknown, max = MAX_FIELD): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

function parse(raw: string): ClientMessage | null {
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (
    message.type === "hello" &&
    isText(message.nickname, 50) &&
    isText(message.clientId, 100)
  ) {
    return {
      type: "hello",
      nickname: message.nickname,
      clientId: message.clientId,
    };
  }
  if (
    message.type === "view" &&
    (message.path === null || isText(message.path))
  ) {
    return { type: "view", path: message.path };
  }
  return null;
}
