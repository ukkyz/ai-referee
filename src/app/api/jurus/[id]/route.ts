import { deleteCustomJurus, getCustomJurus, upsertCustomJurus } from '@/server/db/repositories';
import { validateJurus } from '@/server/db/validate';
import { jsonError, readJson, serverError } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** GET /api/jurus/:id */
export async function GET(_req: Request, { params }: Context) {
  try {
    const { id } = await params;
    const jurus = getCustomJurus(id);
    if (!jurus) return jsonError('Custom jurus not found', 404);
    return Response.json({ jurus });
  } catch (err) {
    return serverError('GET /api/jurus/[id]', err);
  }
}

/** PUT /api/jurus/:id — create or update (the URL id wins over the body id). */
export async function PUT(req: Request, { params }: Context) {
  try {
    const { id } = await params;
    const body = await readJson(req);
    const candidate = body && typeof body === 'object' && 'jurus' in body ? (body as { jurus: unknown }).jurus : body;
    const jurus = validateJurus(candidate);
    if (!jurus) return jsonError('Invalid jurus payload');
    return Response.json({ jurus: upsertCustomJurus({ ...jurus, id }) });
  } catch (err) {
    return serverError('PUT /api/jurus/[id]', err);
  }
}

/** DELETE /api/jurus/:id */
export async function DELETE(_req: Request, { params }: Context) {
  try {
    const { id } = await params;
    if (!deleteCustomJurus(id)) return jsonError('Custom jurus not found', 404);
    return Response.json({ ok: true });
  } catch (err) {
    return serverError('DELETE /api/jurus/[id]', err);
  }
}
