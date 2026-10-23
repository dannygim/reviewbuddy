import type { Thread } from "./api";

export type Participant = {
  clientId: string;
  nickname: string;
  /** The file this participant has open, or null. */
  path: string | null;
};

/** Messages the server publishes on the WebSocket (docs/design/API.md). */
export type ServerEvent =
  | { type: "presence.changed"; participants: Participant[] }
  | { type: "thread.created" | "thread.updated"; thread: Thread }
  | { type: "thread.deleted"; threadId: string }
  | { type: "file.changed"; path: string }
  | { type: "tree.changed" }
  | { type: "session.ended" };

/** Messages a browser sends on the WebSocket. */
export type ClientMessage =
  | { type: "hello"; nickname: string; clientId: string }
  | { type: "view"; path: string | null };
