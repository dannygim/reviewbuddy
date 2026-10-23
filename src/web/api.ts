import type {
  ErrorResponse,
  FileView,
  Health,
  TreeResponse,
} from "../shared/api";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ErrorResponse | null;
    throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export const fetchHealth = () => getJson<Health>("/api/health");
export const fetchTree = () => getJson<TreeResponse>("/api/tree");
export const fetchFile = (path: string) =>
  getJson<FileView>(`/api/file?path=${encodeURIComponent(path)}`);
export const rawUrl = (path: string) =>
  `/api/raw?path=${encodeURIComponent(path)}`;
