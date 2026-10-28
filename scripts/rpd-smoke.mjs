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
  if (path === '/') {
    const scriptSources = [...text.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]);
    if (scriptSources.length === 0) {
      console.log('[banner-deployment-diagnostic] No script asset URL found in production HTML.');
    }
    for (const source of scriptSources) {
      const assetUrl = new URL(source, response.url);
      const assetResponse = await fetch(assetUrl, { redirect: 'follow' });
      if (!assetResponse.ok) {
        console.log(`[banner-deployment-diagnostic] asset HTTP ${assetResponse.status}: ${assetUrl.pathname}`);
        continue;
      }
      const bundle = await assetResponse.text();
      console.log(
        `[banner-deployment-diagnostic] ${assetUrl.pathname} `
        + `hasHomeBanner=${bundle.includes('data-home-top-banner')} `
        + `hasStaticWrapper=${bundle.includes('!static px-4 py-2')} `
        + `hasOldRelativeZ0Wrapper=${bundle.includes('relative z-0 px-4 py-2')}`,
      );
    }
  }
}
console.log(`Smoke OK: ${checks.length} public routes and linear-exam-secure-v1 release marker`);
