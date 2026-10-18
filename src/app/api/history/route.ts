import { clearReports, insertReport, listReports } from '@/server/db/repositories';
import { validateReport } from '@/server/db/validate';
import { jsonError, readJson, serverError } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/history?limit=50 — verdicts, newest first (full reports). */
export function GET(req: Request) {
  try {
    const limit = Number(new URL(req.url).searchParams.get('limit') ?? 50);
    return Response.json({ reports: listReports(Number.isFinite(limit) ? limit : 50) });
  } catch (err) {
    return serverError('GET /api/history', err);
  }
}

/** POST /api/history — save a finished performance report. */
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const candidate = body && typeof body === 'object' && 'report' in body ? (body as { report: unknown }).report : body;
    const report = validateReport(candidate);
    if (!report) return jsonError('Invalid report payload');
    return Response.json({ report: insertReport(report) }, { status: 201 });
  } catch (err) {
    return serverError('POST /api/history', err);
  }
}

/** DELETE /api/history — clear all saved verdicts. */
export function DELETE() {
  try {
    return Response.json({ ok: true, deleted: clearReports() });
  } catch (err) {
    return serverError('DELETE /api/history', err);
  }
}
