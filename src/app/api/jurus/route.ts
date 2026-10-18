import { listCustomJurus, upsertCustomJurus } from '@/server/db/repositories';
import { validateJurus } from '@/server/db/validate';
import { jsonError, readJson, serverError } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/jurus — all custom (user-created) jurus. Presets ship in code. */
export function GET() {
  try {
    return Response.json({ jurus: listCustomJurus() });
  } catch (err) {
    return serverError('GET /api/jurus', err);
  }
}

/** POST /api/jurus — create a custom jurus (upsert by id). */
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const candidate = body && typeof body === 'object' && 'jurus' in body ? (body as { jurus: unknown }).jurus : body;
    const jurus = validateJurus(candidate);
    if (!jurus) return jsonError('Invalid jurus payload');
    return Response.json({ jurus: upsertCustomJurus(jurus) }, { status: 201 });
  } catch (err) {
    return serverError('POST /api/jurus', err);
  }
}
