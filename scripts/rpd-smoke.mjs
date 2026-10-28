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

try {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      try {
        await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.getByRole('button', { name: /lihat.*tamu/i }).first().click({ timeout: 15000 }).catch(() => undefined);
        await page.waitForSelector('[data-home-top-banner]', { timeout: 20000 });
        await page.waitForTimeout(1000);
        const before = await page.evaluate(() => {
          const banner = document.querySelector('[data-home-top-banner]');
          return {
            top: banner ? banner.getBoundingClientRect().top : null,
            position: banner ? getComputedStyle(banner).position : null,
            scrollY: window.scrollY,
            scrollTop: document.scrollingElement?.scrollTop ?? null,
            scrollHeight: document.scrollingElement?.scrollHeight ?? null,
            clientHeight: document.scrollingElement?.clientHeight ?? null,
          };
        });
        await page.evaluate(() => window.scrollTo(0, 700));
        await page.waitForTimeout(250);
        const after = await page.evaluate(() => {
          const banner = document.querySelector('[data-home-top-banner]');
          return {
            top: banner ? banner.getBoundingClientRect().top : null,
            position: banner ? getComputedStyle(banner).position : null,
            scrollY: window.scrollY,
            scrollTop: document.scrollingElement?.scrollTop ?? null,
            scrollHeight: document.scrollingElement?.scrollHeight ?? null,
            clientHeight: document.scrollingElement?.clientHeight ?? null,
          };
        });
        const scrollDelta = after.scrollY - before.scrollY;
        const bannerDelta = before.top - after.top;
        console.log('[banner-scroll-diagnostic] ' + JSON.stringify({
          viewport: viewport.width,
          before,
          after,
          scrollDelta,
          bannerDelta,
          followsDocumentScroll: scrollDelta > 0 && Math.abs(bannerDelta - scrollDelta) < 30,
        }));
      } catch (error) {
        console.log('[banner-scroll-diagnostic] viewport ' + viewport.width + ' failed: ' + String(error));
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
} catch (error) {
  console.log('[banner-scroll-diagnostic] browser check skipped: ' + String(error));
}

console.log(`Smoke OK: ${checks.length} public routes and linear-exam-secure-v1 release marker`);
