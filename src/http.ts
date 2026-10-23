export type Handler = (req: Request) => Response | Promise<Response>;

export function errorResponse(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

/** A path parameter of a Bun route such as /api/threads/:id. */
export function param(req: Request, name: string): string {
  return (
    (req as Request & { params: Record<string, string> }).params[name] ?? ""
  );
}
