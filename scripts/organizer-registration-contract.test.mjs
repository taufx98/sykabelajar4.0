import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20261031171605_stage_4_organizer_invitation_membership.sql', import.meta.url),
  'utf8',
);
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const loginPage = await readFile(new URL('../src/pages/LoginPage.tsx', import.meta.url), 'utf8');
const registerPage = await readFile(new URL('../src/pages/RegisterPage.tsx', import.meta.url), 'utf8');
const invitePage = await readFile(new URL('../src/pages/OrganizerInviteJoinPage.tsx', import.meta.url), 'utf8');
const adminPage = await readFile(new URL('../src/pages/AdminOrganizersPage.tsx', import.meta.url), 'utf8');
const memberPage = await readFile(new URL('../src/pages/OrganizerMembersPage.tsx', import.meta.url), 'utf8');
const organizerService = await readFile(new URL('../src/services/organizer.service.ts', import.meta.url), 'utf8');

test('active organizer membership grants the backend organizer role through a private trigger', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION private\.sync_organizer_member_role_for_user/);
  assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path TO ''/);
  assert.match(migration, /public\.organizer_members[\s\S]*status = 'ACTIVE'[\s\S]*is_active = true/);
  assert.match(migration, /public\.profiles[\s\S]*account_type = 'organizer'/);
  assert.match(migration, /'organizer_member'::public\.app_role/);
  assert.match(migration, /CREATE TRIGGER trg_sync_organizer_member_user_role[\s\S]*AFTER INSERT OR UPDATE OR DELETE\s+ON public\.organizer_members/);
  assert.match(migration, /REVOKE ALL ON FUNCTION private\.sync_organizer_member_role_for_user/);
  assert.match(migration, /REVOKE ALL ON FUNCTION private\.sync_organizer_member_user_role/);
});

test('existing active memberships are reconciled without deactivating organizer self-registration eligibility', () => {
  assert.match(migration, /INSERT INTO public\.user_roles[\s\S]*SELECT DISTINCT om\.user_id[\s\S]*FROM public\.organizer_members om[\s\S]*om\.status = 'ACTIVE'[\s\S]*om\.is_active = true/);
  assert.doesNotMatch(migration, /UPDATE public\.user_roles[\s\S]*SET is_active = false[\s\S]*WHERE role = 'organizer_member'/);
});

test('organizer invite join is reachable to signed-in users before they have the organizer role', () => {
  assert.match(app, /path="\/organizer\/join" element=\{<AuthGuard><OrganizerInviteJoinPage \/><\/AuthGuard>\}/);
  assert.match(invitePage, /rpc\('join_organizer'/);
  assert.match(app, /encodeURIComponent\(location\.pathname \+ location\.search\)/);
  assert.match(invitePage, /await refreshUser\(\)/);
  assert.match(invitePage, /setSelectedOrganizerId/);
  assert.match(invitePage, /navigate\('\/organizer'/);
  assert.match(invitePage, /p_slug:[\s\S]*p_access_code:/);
});

test('invitation context survives login and account registration', () => {
  assert.match(loginPage, /const registerTo = redirectTo === '\/home' \? '\/register' :/);
  assert.match(loginPage, /<Link to=\{registerTo\}/);
  assert.match(registerPage, /useSearchParams/);
  assert.match(registerPage, /const loginTo = redirectTo === '\/home' \? '\/login' :/);
  assert.match(registerPage, /<Link to=\{loginTo\}/);
  assert.match(registerPage, /navigate\(loginTo\)/);
});

test('owner and admin invitation controls rotate server-hashed codes instead of writing the legacy plaintext column', () => {
  assert.match(organizerService, /rpc\('rotate_organizer_access_code'/);
  assert.match(memberPage, /rotateOrganizerAccessCode/);
  assert.match(memberPage, /if \(!confirm\('Membuat kode baru akan langsung menonaktifkan kode undangan sebelumnya/);
  assert.match(memberPage, /\/organizer\/join/);
  assert.match(adminPage, /rotateOrganizerAccessCode/);
  assert.doesNotMatch(adminPage, /from\('organizers'\)\.update\(\{\s*access_code/);
  assert.doesNotMatch(adminPage, /org\.access_code/);
});

test('admin console can rotate invitations while workspace owners remain scoped to their own organization', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.rotate_organizer_access_code/);
  assert.match(migration, /private\.current_user_is_admin\(\)/);
  assert.match(migration, /private\.current_user_can_manage_organizer\(p_organizer_id\)/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.rotate_organizer_access_code\(uuid\)\s+TO authenticated/);
});

test('invitation code is displayed only after a rotation and can be copied from the owner workspace', () => {
  assert.match(memberPage, /Kode undangan/);
  assert.match(memberPage, /navigator\.clipboard\.writeText/);
  assert.match(memberPage, /Kode ini hanya ditampilkan saat dibuat/);
});


const efficiencyMigration = await readFile(
  new URL('../supabase/migrations/20261101120000_event_driven_referrals_trigger_optimization.sql', import.meta.url),
  'utf8',
);
const referralPage = await readFile(new URL('../src/pages/ReferralPage.tsx', import.meta.url), 'utf8');
const registrationModal = await readFile(new URL('../src/components/competition/CompetitionRegistrationModal.tsx', import.meta.url), 'utf8');
const registrationService = await readFile(new URL('../src/services/registration.service.ts', import.meta.url), 'utf8');
const platformService = await readFile(new URL('../src/services/platform.service.ts', import.meta.url), 'utf8');
const leaderboardPage = await readFile(new URL('../src/pages/LeaderboardPage.tsx', import.meta.url), 'utf8');
const organizerAuth = await readFile(new URL('../src/services/organizerAuth.service.ts', import.meta.url), 'utf8');
const organizerShell = await readFile(new URL('../src/components/layout/OrganizerShell.tsx', import.meta.url), 'utf8');
const organizerControlCenter = await readFile(new URL('../src/pages/OrganizerControlCenterPage.tsx', import.meta.url), 'utf8');
const realtimeBus = await readFile(new URL('../src/lib/realtimeBus.ts', import.meta.url), 'utf8');
const competitionDetail = await readFile(new URL('../src/pages/CompetitionDetailPage.tsx', import.meta.url), 'utf8');
const chatModerationGate = await readFile(new URL('../src/components/chat/ChatModerationGate.tsx', import.meta.url), 'utf8');

test('referral qualification is event-driven and its hourly scanner is unscheduled', () => {
  assert.match(efficiencyMigration, /CREATE OR REPLACE FUNCTION private\.apply_referral_qualification/i);
  assert.match(efficiencyMigration, /CREATE OR REPLACE FUNCTION private\.capture_referral_activity/i);
  assert.match(efficiencyMigration, /CREATE TRIGGER trg_referral_activity_daily_checkin[\s\S]*ON public\.daily_checkins/i);
  assert.match(efficiencyMigration, /CREATE TRIGGER trg_referral_activity_comment[\s\S]*ON public\.comments/i);
  assert.match(efficiencyMigration, /CREATE TRIGGER trg_referral_activity_follow[\s\S]*ON public\.follows/i);
  assert.match(efficiencyMigration, /CREATE TRIGGER trg_referral_activity_chat[\s\S]*ON public\.chat_messages/i);
  assert.match(efficiencyMigration, /CREATE TRIGGER trg_referral_activity_daily_task[\s\S]*ON public\.daily_task_claims/i);
  assert.match(efficiencyMigration, /CREATE TRIGGER trg_referral_email_confirmed[\s\S]*ON auth\.users/i);
  assert.match(efficiencyMigration, /cron\.unschedule/i);
  assert.doesNotMatch(efficiencyMigration, /cron\.schedule[\s\S]*verify_pending_referrals/i);
  assert.match(efficiencyMigration, /ON CONFLICT \(user_id, event_type, event_id\) DO NOTHING/i);
  assert.match(efficiencyMigration, /email_confirmed_at IS NOT NULL/i);
  assert.match(efficiencyMigration, /interval '24 hours'/i);
  assert.match(efficiencyMigration, /v_occurred_at timestamptz := clock_timestamp\(\)/i);
  assert.match(efficiencyMigration, /SET verified_activity = v_activity,[\s\S]*last_checked_at = v_activity_at/i);
  assert.match(efficiencyMigration, /verified_activity IS NOT NULL[\s\S]*last_checked_at IS NOT NULL/i);
  assert.doesNotMatch(efficiencyMigration, /process_new_referral_event|referral_backfill/i);
  const emailConfirmation = efficiencyMigration.slice(
    efficiencyMigration.indexOf('CREATE OR REPLACE FUNCTION private.process_referral_email_confirmation'),
    efficiencyMigration.indexOf('REVOKE ALL ON FUNCTION private.apply_referral_qualification'),
  );
  assert.doesNotMatch(emailConfirmation, /FROM public\.(daily_checkins|comments|follows|chat_messages|daily_task_claims)/i);
  assert.match(efficiencyMigration, /PERFORM public\.sync_competition_registration_status\(p_competition_id\)/i);
  assert.match(efficiencyMigration, /PERFORM public\.sync_competition_registration_status\(NEW\.competition_id\)/i);
  assert.match(efficiencyMigration, /DROP FUNCTION IF EXISTS private\.sync_due_competition_registration_statuses/i);
  assert.match(efficiencyMigration, /syka-sync-competition-registration-status/i);
});

test('referral accepts a shareable account UUID and preserves existing short referral codes', () => {
  assert.match(efficiencyMigration, /p_referral_code[\s\S]*referral_codes[\s\S]*::uuid/i);
  assert.match(registrationModal, /referralCode/);
  assert.match(registrationModal, /referralCode:\s*referralCode\.trim\(\)\s*\|\|\s*null/);
  assert.match(registrationService, /p_referral_code:\s*input\.referralCode\?\.trim\(\)\s*\|\|\s*null/);
  assert.match(referralPage, /ensure_referral_code|user\.id/);
  assert.match(referralPage, /navigator\.clipboard\.writeText/);
  assert.match(referralPage, /row\.status === 'EXPIRED'/);
  assert.match(efficiencyMigration, /re\.created_at \+ interval '24 hours' <= now\(\)/i);
  assert.match(referralPage, /postgres_changes/);
});

test('referral trigger helpers are private and cannot be called from client roles', () => {
  assert.match(efficiencyMigration, /SECURITY DEFINER[\s\S]*SET search_path TO ''/i);
  assert.match(efficiencyMigration, /REVOKE ALL ON FUNCTION private\.apply_referral_qualification/i);
  assert.match(efficiencyMigration, /REVOKE ALL ON FUNCTION private\.capture_referral_activity/i);
  assert.match(efficiencyMigration, /REFERRAL_REGISTRATION/);
});

test('attempt and competition audit trigger functions are invoked only for meaningful changes', () => {
  assert.match(efficiencyMigration, /CREATE TRIGGER trg_audit_attempt_result_snapshot[\s\S]*?WHEN \([\s\S]*?OLD\.score IS DISTINCT FROM NEW\.score/i);
  assert.match(efficiencyMigration, /CREATE TRIGGER trg_competition_status_history[\s\S]*WHEN \(OLD\.status IS DISTINCT FROM NEW\.status\)/i);
  assert.match(efficiencyMigration, /coalesce\(NEW\.is_preview, false\)/i);
});

test('leaderboard uses Realtime with a five-minute foreground fallback', () => {
  assert.match(leaderboardPage, /postgres_changes/);
  assert.match(leaderboardPage, /addEventListener\('visibilitychange'/);
  assert.match(leaderboardPage, /5 \* 60_000/);
  assert.match(leaderboardPage, /refreshFallback/);
  assert.match(leaderboardPage, /clearInterval\(refreshFallback\)/);
  assert.match(leaderboardPage, /status === 'SUBSCRIBED'/);
  assert.doesNotMatch(leaderboardPage, /,\s*60_000\)/);
  assert.match(leaderboardPage, /document\.visibilityState/);
  assert.match(platformService, /enrichedLeaderboardCache/);
  assert.match(platformService, /schoolLeaderboardCache/);
  assert.match(platformService, /invalidateLeaderboardMemory[\s\S]*enrichedLeaderboardCache\.clear/);
});

test('concurrent organizer workspace consumers share one in-flight request', () => {
  assert.match(organizerAuth, /listCurrentUserOrganizersInFlight/);
  assert.match(organizerAuth, /if \(listCurrentUserOrganizersInFlight\) return listCurrentUserOrganizersInFlight/);
});

test('organizer workspace resolution reuses one authoritative fetched list', () => {
  assert.match(organizerAuth, /resolveCurrentUserOrganizerFrom/);
  assert.match(organizerShell, /const all = await listCurrentUserOrganizers\(\)/);
  assert.match(organizerShell, /resolveCurrentUserOrganizerFrom\(all\)/);
  assert.doesNotMatch(organizerShell, /Promise\.all\(\[listCurrentUserOrganizers\(\),\s*resolveCurrentUserOrganizer\(\)\]\)/);
  assert.match(organizerControlCenter, /resolveCurrentUserOrganizerFrom\(all\)/);
  assert.match(organizerControlCenter, /type: 'organizer-selected'/);
  assert.match(organizerShell, /event\.type === 'organizer-selected'/);
  assert.match(organizerShell, /event\.type === 'organizer-changed'/);
  assert.match(realtimeBus, /organizer-selected/);
  assert.doesNotMatch(organizerControlCenter, /Promise\.all\(\[listCurrentUserOrganizers\(\),\s*resolveCurrentUserOrganizer\(\)\]\)/);
});

test('competition registration phase is reconciled on demand rather than by cron or 30-second API polling', () => {
  assert.match(competitionDetail, /syncCompetitionRegistrationStatus\(String\(base\.id\)\)/);
  assert.doesNotMatch(competitionDetail, /setInterval\s*\(async[\s\S]*syncCompetitionRegistrationStatus/);
  assert.match(efficiencyMigration, /CREATE OR REPLACE FUNCTION public\.check_registration_eligibility[\s\S]*?PERFORM public\.sync_competition_registration_status\(p_competition_id\)/i);
  assert.match(efficiencyMigration, /CREATE OR REPLACE FUNCTION public\.validate_registration_insert[\s\S]*?PERFORM public\.sync_competition_registration_status\(NEW\.competition_id\)/i);
});

test('chat moderation refreshes from owner-scoped Realtime events without periodic API polling', () => {
  assert.match(chatModerationGate, /table: 'chat_user_moderation'/);
  assert.match(chatModerationGate, /table: 'chat_spam_controls'/);
  assert.match(chatModerationGate, /filter: `user_id=eq\.\$\{user\.id\}`/);
  assert.match(chatModerationGate, /scheduleRefresh/);
  assert.match(chatModerationGate, /visibilitychange/);
  assert.doesNotMatch(chatModerationGate, /15000|15_000/);
  assert.match(efficiencyMigration, /CREATE POLICY chat_user_moderation_self_read[\s\S]*USING \(user_id = auth\.uid\(\)\)/i);
  assert.match(efficiencyMigration, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.chat_user_moderation/i);
  assert.match(efficiencyMigration, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.chat_spam_controls/i);
});
