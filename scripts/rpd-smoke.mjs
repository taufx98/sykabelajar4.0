import { readFile } from 'node:fs/promises';

const requiredEnv = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'];
for (const key of requiredEnv) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
}

const html = await readFile('dist/index.html', 'utf8');
if (!/app\.js/i.test(html)) throw new Error('dist/index.html tidak mereferensikan bundle JS aplikasi.');
if (!/supabase/i.test(html)) {
  const bundleMatches = [...html.matchAll(/src="([^"]+\.js)"/gi)].map((m) => m[1]);
  if (!bundleMatches.length) throw new Error('Bundle JS tidak ditemukan di dist/index.html.');
  let bundle = '';
  for (const src of bundleMatches) {
    const filename = src.replace(/^\//, '');
    try { bundle += await readFile(`dist/${filename}`, 'utf8'); } catch { /* ignore missing optional bundle */ }
  }
  if (!/supabase/i.test(bundle)) throw new Error('Bundle production tidak memuat referensi Supabase.');
}

const base = process.env.VITE_SUPABASE_URL.replace(/\/$/, '');
const headers = {
  apikey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  Authorization: `Bearer ${process.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
};

async function rpc(name, body) {
  const response = await fetch(`${base}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${name} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

// Keep CI validation representative of the optimized public data path.
// One bounded snapshot RPC replaces the previous three broad RPC calls.
const snapshot = await rpc('get_home_snapshot', { p_feed_limit: 1 });
if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
  throw new Error('get_home_snapshot bukan object.');
}

const competitions = Array.isArray(snapshot.competitions) ? snapshot.competitions : [];
const leaderboard = Array.isArray(snapshot.leaderboard) ? snapshot.leaderboard : [];
const stats = snapshot.stats && typeof snapshot.stats === 'object' ? snapshot.stats : {};

console.log('[smoke] production bundle: OK');
console.log(`[smoke] snapshot competitions=${competitions.length} leaderboard=${leaderboard.length} stats=object`);
console.log(`[smoke] snapshot keys=${Object.keys(stats).length > 0 ? Object.keys(stats).join(',') : 'none'}`);
