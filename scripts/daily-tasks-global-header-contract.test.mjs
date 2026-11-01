import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('all application routes share the Daily Tasks global header contract', async () => {
  const header = await readFile(new URL('../src/components/layout/GlobalHeader.tsx', import.meta.url), 'utf8');

  assert.match(header, /location\.pathname === '\/home'/);
  assert.match(header, /const isDailyTasks = location\.pathname === '\/daily-tasks'/);
  assert.match(header, /Daily Tasks &amp; Referral/);
  assert.match(header, /<h1[^>]*>\{label\}<\/h1>/);
  assert.doesNotMatch(header, /if \(location\.pathname === '\/daily-tasks'\)/);
  assert.doesNotMatch(header, /if \(location\.pathname === '\/notifications'\)/);
  assert.match(header, /to="\/home"/);
  assert.match(header, /md:hidden/);
  assert.match(header, /min-h-11 min-w-11/);
  assert.match(header, /CalendarDays/);
  assert.match(header, /Asia\/Jakarta/);
  assert.match(header, /AdminCommunicationLinks/);
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
