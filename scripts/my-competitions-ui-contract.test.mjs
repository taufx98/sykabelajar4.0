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



const appLayout = await readFile('src/components/layout/AppLayout.tsx', 'utf8');
const appRoutes = await readFile('src/App.tsx', 'utf8');
const competitionDetailPage = await readFile('src/pages/CompetitionDetailPage.tsx', 'utf8');

test('Lomba Saya uses the global application header rather than defining a local header', () => {
  assert.ok(appRoutes.includes('<Route element={<AuthGuard><AppLayout /></AuthGuard>}>'));
  assert.ok(appRoutes.includes('path="/lomba-saya" element={<MyCompetitionsPage />}'));
  assert.ok(appLayout.includes('!isHomeRoute&&<GlobalHeader navItems={globalHeaderNav}'));
});

test('Lomba Saya toolbar places search and view controls above the status filters', () => {
  assert.ok(page.includes('my-competitions-toolbar-top'));
  assert.ok(page.includes('my-competitions-filter-row'));
  assert.ok(page.includes('my-competitions-mobile-filter-switcher'));
  assert.ok(page.includes('aria-label="Filter sebelumnya"'));
  assert.ok(page.includes('aria-label="Filter berikutnya"'));
});

test('Lomba Saya category chips and certificate notice use restrained dark borders', () => {
  assert.doesNotMatch(page, /border border-accent\/15 bg-accent\/5/);
  assert.ok(page.includes('border-slate-700/70 bg-slate-800/50'));
  assert.ok(page.includes('border-slate-700/55 bg-slate-800/35'));
});

test('competition detail unavailable state is vertically centered and distinguishes missing data from load failures', () => {
  assert.ok(competitionDetailPage.includes('min-h-[calc(100dvh-4rem)]'));
  assert.ok(competitionDetailPage.includes('Detail lomba belum dapat dimuat'));
  assert.ok(competitionDetailPage.includes('Lomba tidak ditemukan'));
  assert.ok(competitionDetailPage.includes('navigate(-1)'));
});


const globalHeader = await readFile('src/components/layout/GlobalHeader.tsx', 'utf8');
const appLayout = await readFile('src/components/layout/AppLayout.tsx', 'utf8');

test('Lomba Saya summary indicators use a compact two-column mobile grid and an accessible collapse control', () => {
  assert.match(page, /my-competitions-summary/);
  assert.match(page, /grid-cols-2 gap-2\.5 sm:gap-4 lg:grid-cols-4/);
  assert.match(page, /summaryExpanded \? 'grid ' : 'hidden sm:grid '/);
  assert.match(page, /summaryExpanded/);
  assert.match(page, /aria-expanded=\{summaryExpanded\}/);
  assert.match(page, /sm:hidden/);
  assert.match(page, /<ChevronDown/);
});

test('Lomba Saya competition grid uses two compact columns on phones while list mode remains one column', () => {
  assert.match(page, /grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3/);
  assert.match(page, /aspect-\[16\/10\]/);
  assert.match(page, /line-clamp-3 sm:line-clamp-none/);
  assert.match(page, /grid grid-cols-1 gap-3/);
  assert.match(page, /p-3 sm:p-4 lg:p-5/);
});

test('admin badge has a stable Lucide shield icon and a single role-driven source', () => {
  assert.match(globalHeader, /ShieldCheck/);
  assert.doesNotMatch(globalHeader, /fa-user-shield/);
  assert.doesNotMatch(globalHeader, /badgeLabel/);
  assert.match(globalHeader, /user\?\.role === 'admin'/);
  assert.doesNotMatch(appLayout, /badgeLabel=/);
});
