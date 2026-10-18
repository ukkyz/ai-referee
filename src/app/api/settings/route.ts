import { getSettings, saveSettings } from '@/server/db/repositories';
import { validateSettings } from '@/server/db/validate';
import { jsonError, readJson, serverError } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/settings — referee settings (defaults until first saved). */
export function GET() {
  try {
    return Response.json(getSettings());
  } catch (err) {
    return serverError('GET /api/settings', err);
  }
}

/** PUT /api/settings — replace the single settings row. */
export async function PUT(req: Request) {
  try {
    const body = await readJson(req);
    const candidate = body && typeof body === 'object' && 'settings' in body ? (body as { settings: unknown }).settings : body;
    const settings = validateSettings(candidate);
    if (!settings) return jsonError('Invalid settings payload');
    return Response.json({ settings: saveSettings(settings) });
  } catch (err) {
    return serverError('PUT /api/settings', err);
  }
}
