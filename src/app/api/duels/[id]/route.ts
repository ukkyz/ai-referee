import { deleteDuel, getDuel } from '@/server/db/repositories';
import { jsonError, serverError } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** GET /api/duels/:id */
export async function GET(_req: Request, { params }: Context) {
  try {
    const { id } = await params;
    const duel = getDuel(id);
    if (!duel) return jsonError('Duel report not found', 404);
    return Response.json({ duel });
  } catch (err) {
    return serverError('GET /api/duels/[id]', err);
  }
}

/** DELETE /api/duels/:id */
export async function DELETE(_req: Request, { params }: Context) {
  try {
    const { id } = await params;
    if (!deleteDuel(id)) return jsonError('Duel report not found', 404);
    return Response.json({ ok: true });
  } catch (err) {
    return serverError('DELETE /api/duels/[id]', err);
  }
}
