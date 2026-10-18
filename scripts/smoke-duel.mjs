// API smoke test for the Tanding (duel) + 3-camera rig endpoints.
// Usage: BASE=http://localhost:3100 node scripts/smoke-duel.mjs
// Expects /tmp/duel-report.json and /tmp/rig-profile.json fixtures.
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:3100';
const report = JSON.parse(fs.readFileSync('/tmp/duel-report.json', 'utf8'));
const rigProfile = JSON.parse(fs.readFileSync('/tmp/rig-profile.json', 'utf8'));

let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name} ${extra}`);
  }
};

const j = async (res) => {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

// Health: schema v3 + rig persistence flag
let res = await fetch(`${BASE}/api/health`);
let body = await j(res);
check('health 200', res.ok);
check('health reports duels + rig counts', typeof body.counts?.duels === 'number' && typeof body.counts?.rigPersisted === 'boolean', JSON.stringify(body).slice(0, 200));

// Create duel with source 'rig' (requires the v3 CHECK)
res = await fetch(`${BASE}/api/duels`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(report) });
body = await j(res);
check('POST /api/duels (source=rig) accepted', res.ok, `${res.status} ${JSON.stringify(body).slice(0, 160)}`);

// List
res = await fetch(`${BASE}/api/duels`);
body = await j(res);
check('GET /api/duels lists the duel', res.ok && (body.duels ?? []).some((d) => d.id === report.id));

// Get one
res = await fetch(`${BASE}/api/duels/${report.id}`);
body = await j(res);
check('GET /api/duels/[id] returns full report', res.ok && (body.duel?.id === report.id) && body.duel.fighters?.[0]?.score === 4);

// Invalid duel rejected
res = await fetch(`${BASE}/api/duels`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'bad' }) });
check('POST invalid duel → 400', res.status === 400, `${res.status}`);

// Rig profile lifecycle
res = await fetch(`${BASE}/api/rig`);
body = await j(res);
check('GET /api/rig initially empty', res.ok && (body.profile === null || body.profile === undefined), JSON.stringify(body).slice(0, 120));

res = await fetch(`${BASE}/api/rig`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rigProfile) });
body = await j(res);
check('PUT /api/rig saves calibration', res.ok && body.profile?.cameras?.length === 3, `${res.status} ${JSON.stringify(body).slice(0, 160)}`);

res = await fetch(`${BASE}/api/rig`);
body = await j(res);
check('GET /api/rig returns saved profile', res.ok && body.profile?.name === rigProfile.name);

res = await fetch(`${BASE}/api/rig`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cameras: [] }) });
check('PUT invalid rig → 400', res.status === 400, `${res.status}`);

res = await fetch(`${BASE}/api/rig`, { method: 'DELETE' });
check('DELETE /api/rig clears profile', res.ok);
res = await fetch(`${BASE}/api/rig`);
body = await j(res);
check('GET /api/rig empty after delete', res.ok && (body.profile === null || body.profile === undefined));

// Delete duel
res = await fetch(`${BASE}/api/duels/${report.id}`, { method: 'DELETE' });
check('DELETE /api/duels/[id]', res.ok, `${res.status}`);
res = await fetch(`${BASE}/api/duels/${report.id}`);
check('GET deleted duel → 404', res.status === 404, `${res.status}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
