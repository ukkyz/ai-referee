import { deleteReport, getReport } from '@/server/db/repositories';
import { jsonError, serverError } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** GET /api/history/:id */
export async function GET(_req: Request, { params }: Context) {
  try {
    const { id } = await params;
    const report = getReport(id);
    if (!report) return jsonError('Report not found', 404);
    return Response.json({ report });
  } catch (err) {
    return serverError('GET /api/history/[id]', err);
  }
}

/** DELETE /api/history/:id */
export async function DELETE(_req: Request, { params }: Context) {
  try {
    const { id } = await params;
    if (!deleteReport(id)) return jsonError('Report not found', 404);
    return Response.json({ ok: true });
  } catch (err) {
    return serverError('DELETE /api/history/[id]', err);
  }
}
