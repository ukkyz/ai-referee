import 'server-only';

/** Shared helpers for Route Handlers: consistent `{ error }` JSON failures. */

export function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export function serverError(route: string, err: unknown): Response {
  console.error(`[api] ${route} failed`, err);
  return jsonError('Internal server error', 500);
}

/** Parse a JSON request body, returning null for empty/invalid bodies. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
