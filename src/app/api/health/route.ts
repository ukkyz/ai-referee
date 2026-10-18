import { healthCheck } from '@/server/db/repositories';
import { serverError } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/health — liveness + SQLite status (used by smoke tests / ops). */
export function GET() {
  try {
    return Response.json({ status: 'ok', ...healthCheck(), timestamp: new Date().toISOString() });
  } catch (err) {
    return serverError('GET /api/health', err);
  }
}
