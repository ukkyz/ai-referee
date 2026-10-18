import { clearDuels, insertDuel, listDuels } from '@/server/db/repositories';
import { validateDuelReport } from '@/server/db/validate';
import { jsonError, readJson, serverError } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/duels?limit=50 — Tanding match reports, newest first. */
export function GET(req: Request) {
  try {
    const limit = Number(new URL(req.url).searchParams.get('limit') ?? 50);
    return Response.json({ duels: listDuels(Number.isFinite(limit) ? limit : 50) });
  } catch (err) {
    return serverError('GET /api/duels', err);
  }
}

/** POST /api/duels — save a finished duel (Tanding) report. */
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const candidate = body && typeof body === 'object' && 'duel' in body ? (body as { duel: unknown }).duel : body;
    const duel = validateDuelReport(candidate);
    if (!duel) return jsonError('Invalid duel report payload');
    return Response.json({ duel: insertDuel(duel) }, { status: 201 });
  } catch (err) {
    return serverError('POST /api/duels', err);
  }
}

/** DELETE /api/duels — clear all saved duels. */
export function DELETE() {
  try {
    return Response.json({ ok: true, deleted: clearDuels() });
  } catch (err) {
    return serverError('DELETE /api/duels', err);
  }
}
