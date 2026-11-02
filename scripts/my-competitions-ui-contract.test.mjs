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
  assert.doesNotMatch(page, /REGISTRATION_FILTER_STATUSES[^;]*'cancelled'/);
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
  assert.match(page, /encodeURIComponent\(competition\.slug\)/);
});

test('the participant dashboard contains no hard-coded sample competitions or certificate fixtures', () => {
  assert.doesNotMatch(page, /INITIAL_COMPETITIONS|DUMMY_CERTIFICATES|NSSC 2026|CERT-2026-/);
});
