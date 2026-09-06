const base = process.env.TARGET_SMOKE_URL || 'https://sykabelajar.my.id';
const checks = ['/', '/verify/SMOKE-NOT-FOUND', '/peserta-kolektif/login'];
for (const path of checks) {
  const response = await fetch(`${base}${path}`, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Smoke failed ${path}: HTTP ${response.status}`);
  const text = await response.text();
  if (!text.includes('<!doctype html') && !text.includes('<html')) throw new Error(`Smoke failed ${path}: no HTML`);
}
console.log(`Smoke OK: ${checks.length} public routes`);
