import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile('src/pages/MyCompetitionsPage.tsx', 'utf8');
const participantService = await readFile('src/services/participant.service.ts', 'utf8');
const certificateService = await readFile('src/services/certificate.service.ts', 'utf8');

test('Lomba Saya stays connected to the authenticated participant dashboard RPC', () => {
  assert.match(participantService, /rpc\(['"]list_my_competition_dashboard['"]\)/);
  assert.match(page, /listMyCompetitionDashboard/);
  assert.match(page, /user\?\.id/);
  assert.match(page, /isGuest/);
});

test('dashboard status filters keep registration and cancellation distinct', () => {
  for (const filter of ['all', 'registration', 'in_progress', 'waiting_result', 'result_published', 'cancelled']) {
    assert.match(page, new RegExp("id:\\s*'" + filter + "'"));
  }
  assert.match(page, /competitionStatus\s*===\s*'CANCELLED'/);
  assert.match(page, /REGISTRATION_FILTER_STATUSES/);
  assert.match(page, /REGISTRATION_FILTER_STATUSES: DashboardStatus\[\] = \['pending', 'rejected', 'registered'\]/);
});

test('agenda milestones are derived from dates returned for the signed-in competitions', () => {
  for (const field of ['registration_starts_at', 'registration_ends_at', 'starts_at', 'ends_at', 'announcement_at']) {
    assert.match(page, new RegExp('competition\\.' + field));
  }
  assert.match(page, /Date\.now\(\)/);
  assert.match(page, /buildAgendaEvents/);
});

test('certificate history uses the canonical certificate RPC and only exposes returned documents', () => {
  assert.match(certificateService, /rpc\(['"]list_my_canonical_certificates['"]\)/);
  assert.match(page, /listMyCanonicalCertificates/);
  assert.match(page, /certificate_url/);
  assert.match(page, /certificate\.certificate_url/);
});

test('individual, collective, exam and official-result actions use existing routes', () => {
  assert.match(page, /profile\/collective-history/);
  assert.match(page, /\/kerja/);
  assert.match(page, /\/hasil/);
  assert.match(page, /encodeURIComponent\(item\.competition\.slug\)/);
});

test('the participant dashboard contains no hard-coded sample competitions or certificate fixtures', () => {
  assert.doesNotMatch(page, /INITIAL_COMPETITIONS|DUMMY_CERTIFICATES|NSSC 2026|CERT-2026-/);
});

const indexCss = await readFile('src/index.css', 'utf8');

test('Lomba Saya follows the reference page composition and dark visual system', () => {
  assert.match(page, /my-competitions-page/);
  assert.match(page, /max-w-7xl space-y-8/);
  assert.match(page, /lg:grid-cols-4/);
  assert.match(page, /lg:grid-cols-3/);
  assert.match(indexCss, /\.my-competitions-page/);
  assert.match(indexCss, /#070b14/i);
});

test('list mode uses the compact square competition mark instead of a stretched poster', () => {
  assert.match(page, /viewMode === 'list'/);
  assert.match(page, /h-12 w-12/);
  assert.match(page, /Trophy/);
});

test('competition detail hero uses the actual poster returned by the dashboard', () => {
  assert.match(page, /competition\.poster_url/);
  assert.match(page, /alt=\{['"]Poster ['"] \+ item\.competition\.title\}/);
});
