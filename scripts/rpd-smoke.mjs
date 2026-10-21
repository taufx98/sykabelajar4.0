const base = process.env.TARGET_SMOKE_URL || 'https://sykabelajar.my.id';
const checks = ['/', '/verify/SMOKE-NOT-FOUND', '/peserta-kolektif/login'];
for (const path of checks) {
  const response = await fetch(`${base}${path}`, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Smoke failed ${path}: HTTP ${response.status}`);
  const text = await response.text();
  if (!text.includes('<!doctype html') && !text.includes('<html')) throw new Error(`Smoke failed ${path}: no HTML`);
  if (path === '/' && !text.includes('<meta name="syka-release" content="linear-exam-secure-v1" />')) {
    throw new Error('Smoke failed /: production is not yet serving the linear-exam-secure-v1 release.');
  }
}
console.log(`Smoke OK: ${checks.length} public routes and linear-exam-secure-v1 release marker`);
