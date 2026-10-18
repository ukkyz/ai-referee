import { clearRigProfile, getRigProfile, saveRigProfile } from '@/server/db/repositories';
import { validateRigProfile } from '@/lib/duel/rig/calibration';
import { jsonError, readJson, serverError } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/rig — active multi-camera rig calibration profile (null until imported). */
export function GET() {
  try {
    return Response.json(getRigProfile());
  } catch (err) {
    return serverError('GET /api/rig', err);
  }
}

/** PUT /api/rig — store/replace the active rig calibration profile. */
export async function PUT(req: Request) {
  try {
    const body = await readJson(req);
    const candidate = body && typeof body === 'object' && 'profile' in body ? (body as { profile: unknown }).profile : body;
    const profile = validateRigProfile(candidate);
    if (!profile) return jsonError('Invalid rig profile: expected 2-6 cameras with intrinsics and 3x3/3 extrinsics');
    return Response.json({ profile: saveRigProfile(profile) });
  } catch (err) {
    return serverError('PUT /api/rig', err);
  }
}

/** DELETE /api/rig — remove the stored calibration (rig falls back to uncalibrated 2D). */
export function DELETE() {
  try {
    clearRigProfile();
    return Response.json({ ok: true });
  } catch (err) {
    return serverError('DELETE /api/rig', err);
  }
}
