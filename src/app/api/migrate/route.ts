import { importLegacyData } from '@/server/db/repositories';
import { jsonError, readJson, serverError } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/migrate — one-time import of pre-Next.js localStorage data.
 * Body: { settings?, jurus?: Jurus[], reports?: Report[] }.
 * Idempotent: rows that already exist are left untouched.
 */
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError('Invalid migration payload');
    const input = body as { settings?: unknown; jurus?: unknown; reports?: unknown };
    const imported = importLegacyData({
      settings: input.settings,
      jurus: Array.isArray(input.jurus) ? input.jurus : undefined,
      reports: Array.isArray(input.reports) ? input.reports : undefined,
    });
    return Response.json({ ok: true, imported });
  } catch (err) {
    return serverError('POST /api/migrate', err);
  }
}
