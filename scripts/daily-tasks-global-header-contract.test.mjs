import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Daily Tasks uses one concise global header with a mobile-only back control', async () => {
  const header = await readFile(new URL('../src/components/layout/GlobalHeader.tsx', import.meta.url), 'utf8');
  const start = header.indexOf("if (location.pathname === '/daily-tasks')");
  const end = header.indexOf("if (location.pathname === '/notifications')", start);
  assert.ok(start >= 0 && end > start, 'Daily Tasks header must be owned by GlobalHeader');
  const dailyHeader = header.slice(start, end);

  assert.match(dailyHeader, /Daily Tasks &amp; Referral/);
  assert.doesNotMatch(dailyHeader, /Daily Tasks &amp; Program Referral/);
  assert.doesNotMatch(dailyHeader, /<span>Belajar<\/span>/);
  assert.match(dailyHeader, /to="\/home"/);
  assert.match(dailyHeader, /md:hidden/);
  assert.match(dailyHeader, /min-h-11 min-w-11/);
});

test('reduced-motion preference leaves the Home running-text marquee moving', async () => {
  const home = await readFile(new URL('../src/pages/HomePage.tsx', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');

  assert.match(home, /home-running-text/);
  assert.match(styles, /html\.reduce-motion \.home-running-text/);
  assert.match(styles, /animation-iteration-count:\s*infinite\s*!important/);
});

test('banner carousel captures pointer drags without breaking banner link clicks', async () => {
  const carousel = await readFile(new URL('../src/components/ui/BannerCarousel.tsx', import.meta.url), 'utf8');

  assert.match(carousel, /setPointerCapture\(event\.pointerId\)/);
  assert.match(carousel, /pointerId/);
  assert.match(carousel, /touch-pan-y/);
  assert.match(carousel, /onClickCapture/);
  assert.match(carousel, /draggable=\{false\}/);
  assert.match(carousel, /closest\('button'\)/);
});
