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
    try { bundle += await readFile(`dist/${filename}`, 'utf8'); } catch { /* HTML contract still protects the build. */ }
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

const stats = await rpc('get_platform_stats', {});
if (!Array.isArray(stats)) throw new Error('get_platform_stats bukan array.');

const leaderboard = await rpc('get_public_leaderboard', { p_limit: 5 });
if (!Array.isArray(leaderboard)) throw new Error('get_public_leaderboard bukan array.');

const competitions = await rpc('get_public_competitions', {});
if (!Array.isArray(competitions)) throw new Error('get_public_competitions bukan array.');

console.log('[smoke] production bundle: OK');
console.log(`[smoke] stats rows=${stats.length} leaderboard rows=${leaderboard.length} competitions rows=${competitions.length}`);
