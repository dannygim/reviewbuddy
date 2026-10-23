import type {
  Comment,
  ErrorResponse,
  FileView,
  PromptResponse,
  SessionInfo,
  Thread,
  TreeResponse,
} from "../shared/api";

let token = "";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** 401: this browser has not entered the PIN of the running server. */
export const needsPin = (error: unknown) =>
  error instanceof ApiError && error.status === 401;

async function apiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as ErrorResponse | null;
  return new ApiError(
    res.status,
    body?.error ?? `${res.status} ${res.statusText}`,
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as T;
}

/** Writes carry the session token (see docs/design/セキュリティ.md). */
function send<T>(method: string, path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Reviewbuddy-Token": token,
    },
    body: JSON.stringify(body),
  });
}

/** Sets the access cookie (see docs/adr/0007-access-pin.md). */
export async function login(pin: string): Promise<void> {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin }),
  });
  if (!res.ok) throw await apiError(res);
}

export async function fetchSession(): Promise<SessionInfo> {
  const session = await request<SessionInfo>("/api/session");
  token = session.token;
  return session;
}

export const fetchTree = () => request<TreeResponse>("/api/tree");
export const fetchFile = (path: string) =>
  request<FileView>(`/api/file?path=${encodeURIComponent(path)}`);
export const rawUrl = (path: string) =>
  `/api/raw?path=${encodeURIComponent(path)}`;
export const fetchThreads = () => request<Thread[]>("/api/threads");

type Author = Pick<Comment, "author" | "clientId">;

export const createThread = (
  input: Author &
    Pick<Thread, "path" | "startLine" | "endLine" | "originView"> & {
      body: string;
    },
) => send<Thread>("POST", "/api/threads", input);

export const addComment = (
  threadId: string,
  input: Author & { body: string },
) => send<Thread>("POST", `/api/threads/${threadId}/comments`, input);

export const editComment = (id: string, clientId: string, body: string) =>
  send<Thread>("PATCH", `/api/comments/${id}`, { clientId, body });

export const deleteComment = (id: string, clientId: string) =>
  send<{ thread: Thread } | { deletedThreadId: string }>(
    "DELETE",
    `/api/comments/${id}`,
    { clientId },
  );

export const resolveThread = (id: string, author: string) =>
  send<Thread>("POST", `/api/threads/${id}/resolve`, { author });

export const reopenThread = (id: string) =>
  send<Thread>("POST", `/api/threads/${id}/reopen`, {});

export const requestPrompt = (
  threadIds: string[],
  resolve: boolean,
  author: string,
) =>
  send<PromptResponse>("POST", "/api/prompt", { threadIds, resolve, author });

export const endSession = () =>
  send<SessionInfo>("POST", "/api/session/end", {});
