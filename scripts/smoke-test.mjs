/**
 * End-to-end smoke test for the SQLite-backed API.
 * Requires a running server:  npm run build && npm run start
 * Then, in another terminal:  node scripts/smoke-test.mjs
 * Override the target with BASE_URL=http://localhost:3000
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

let failures = 0;
function check(label, condition, extra = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label} ${extra}`);
  }
}

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

const jurus = {
  id: 'smoke-jurus-1',
  name: 'Smoke Jurus',
  subtitle: 'API test',
  description: 'Temporary jurus created by scripts/smoke-test.mjs',
  level: 'Pemula',
  targetDuration: 30,
  tolerance: 5,
  custom: true,
  createdAt: Date.now(),
  steps: [{ uid: 'sikap-pasang@1', t: 1, hold: 1, pose: { id: 'sikap-pasang', name: 'Sikap Pasang' } }],
};

const report = {
  id: 'smoke-report-1',
  createdAt: Date.now(),
  jurusId: 'smoke-jurus-1',
  jurusName: 'Smoke Jurus',
  source: 'video',
  duration: 30,
  targetDuration: 30,
  tolerance: 5,
  kebenaran: 95,
  kemantapan: 55,
  hukuman: 0,
  total: 150,
  index: 90,
  predikat: 'Sangat Baik',
  errorsTotal: 2,
  steps: [],
  judges: [],
};

console.log(`Smoke-testing ${BASE} …`);

// health
const health = await req('GET', '/api/health');
check('GET /api/health → 200 ok', health.status === 200 && health.data?.ok === true, JSON.stringify(health.data));

// settings round-trip
const before = await req('GET', '/api/settings');
check('GET /api/settings → settings object', before.status === 200 && typeof before.data?.settings?.strictness === 'number');
const putSettings = await req('PUT', '/api/settings', { settings: { ...before.data.settings, strictness: 1.25 } });
check('PUT /api/settings → strictness 1.25', putSettings.status === 200 && putSettings.data?.settings?.strictness === 1.25);
const afterSettings = await req('GET', '/api/settings');
check('settings persisted (persisted=true)', afterSettings.data?.persisted === true && afterSettings.data?.settings?.strictness === 1.25);
await req('PUT', '/api/settings', { settings: before.data.settings });

// jurus CRUD
const created = await req('POST', '/api/jurus', { jurus });
check('POST /api/jurus → 201', created.status === 201 && created.data?.jurus?.id === jurus.id, JSON.stringify(created.data));
const listed = await req('GET', '/api/jurus');
check('GET /api/jurus contains smoke jurus', listed.data?.jurus?.some((j) => j.id === jurus.id) === true);
const updated = await req('PUT', `/api/jurus/${jurus.id}`, { jurus: { ...jurus, name: 'Smoke Jurus II' } });
check('PUT /api/jurus/:id updates name', updated.data?.jurus?.name === 'Smoke Jurus II');
const fetched = await req('GET', `/api/jurus/${jurus.id}`);
check('GET /api/jurus/:id → updated jurus', fetched.status === 200 && fetched.data?.jurus?.name === 'Smoke Jurus II');

// history CRUD
const saved = await req('POST', '/api/history', { report });
check('POST /api/history → 201', saved.status === 201 && saved.data?.report?.id === report.id, JSON.stringify(saved.data));
const history = await req('GET', '/api/history?limit=5');
check('GET /api/history contains smoke report', history.data?.reports?.some((r) => r.id === report.id) === true);
const one = await req('GET', `/api/history/${report.id}`);
check('GET /api/history/:id → report', one.status === 200 && one.data?.report?.total === 150);
const badReport = await req('POST', '/api/history', { report: { id: 'broken' } });
check('POST invalid report → 400', badReport.status === 400);

// legacy migration is idempotent
const mig1 = await req('POST', '/api/migrate', { jurus: [{ ...jurus, id: 'smoke-legacy-1' }], reports: [{ ...report, id: 'smoke-legacy-r1' }] });
check('POST /api/migrate imports legacy rows', mig1.data?.imported?.jurus === 1 && mig1.data?.imported?.reports === 1, JSON.stringify(mig1.data));
const mig2 = await req('POST', '/api/migrate', { jurus: [{ ...jurus, id: 'smoke-legacy-1' }], reports: [{ ...report, id: 'smoke-legacy-r1' }] });
check('POST /api/migrate again → 0 new rows (idempotent)', mig2.data?.imported?.jurus === 0 && mig2.data?.imported?.reports === 0);

// cleanup
await req('DELETE', `/api/history/${report.id}`);
await req('DELETE', '/api/history/smoke-legacy-r1');
await req('DELETE', `/api/jurus/${jurus.id}`);
await req('DELETE', '/api/jurus/smoke-legacy-1');
const gone = await req('GET', `/api/jurus/${jurus.id}`);
check('DELETE then GET → 404', gone.status === 404);

if (failures) {
  console.error(`\n${failures} smoke check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll smoke checks passed.');
