import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const helperSource = await readFile(new URL('../src/lib/referralAttribution.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;
const { isValidReferralId } = await import(moduleUrl);
const validId = '123e4567-e89b-42d3-a456-426614174000';

test('accepts canonical UUID referral IDs and rejects malformed values', () => {
  assert.equal(isValidReferralId(validId), true);
  assert.equal(isValidReferralId('not-a-uuid'), false);
  assert.equal(isValidReferralId(''), false);
  assert.equal(isValidReferralId(null), false);
});

test('signup referral is carried as auth user metadata and handled by a database trigger', async () => {
  const appContext = await readFile(new URL('../src/store/AppContext.tsx', import.meta.url), 'utf8');
  const authService = await readFile(new URL('../src/services/auth.service.ts', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../supabase/migrations/20261101043516_referral_signup_attribution.sql', import.meta.url), 'utf8');
  assert.match(appContext, /referral_id:\s*data\.referralCode/);
  assert.match(authService, /referral_id\?:\s*string/);
  assert.match(migration, /AFTER INSERT ON auth\.users/);
  assert.match(migration, /NEW\.raw_user_meta_data\s*->>\s*'referral_id'/);
  assert.match(migration, /ON CONFLICT \(referred_user_id\) DO NOTHING/);
  assert.match(migration, /email_confirmed_at IS NOT NULL/);
});


test('referral campaigns keep a base reward and apply event rewards only inside the configured window', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20261101052650_referral_campaign_reward_settings.sql', import.meta.url), 'utf8');
  assert.match(migration, /base_reward_amount integer NOT NULL DEFAULT 5/);
  assert.match(migration, /event_reward_amount integer/);
  assert.match(migration, /private\.current_user_is_admin\(\)/);
  assert.match(migration, /p_base_reward_amount/);
  assert.match(migration, /p_event_reward_amount/);
  assert.match(migration, /CASE WHEN v_event_active THEN v_row\.event_reward_amount ELSE v_row\.base_reward_amount END/);
  assert.match(migration, /s\.is_active = true/);
  assert.match(migration, /s\.starts_at IS NULL OR v_now >= s\.starts_at/);
  assert.match(migration, /s\.ends_at IS NULL OR v_now < s\.ends_at/);
  assert.match(migration, /v_reward_amount,\s*'PENDING'/);
  assert.match(migration, /ON CONFLICT \(referred_user_id\) DO NOTHING/);
  assert.match(migration, /REVOKE ALL ON TABLE private\.referral_program_settings FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_referral_program_settings\(\) TO authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_update_referral_program_settings/);
  assert.match(migration, /REVOKE ALL ON FUNCTION private\.capture_signup_referral\(\) FROM PUBLIC, anon, authenticated, service_role/);
});

test('referral history exposes stored per-invite reward without recalculating old earnings', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20261101052650_referral_campaign_reward_settings.sql', import.meta.url), 'utf8');
  const referralPanel = await readFile(new URL('../src/components/referrals/ReferralProgramPanel.tsx', import.meta.url), 'utf8');
  const settingsPanel = await readFile(new URL('../src/components/admin/ReferralSettingsPanel.tsx', import.meta.url), 'utf8');
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_my_referrals_v2\(\)/);
  assert.match(migration, /re\.reward_amount/);
  assert.match(referralPanel, /supabase\.rpc\('get_my_referrals_v2'\)/);
  assert.match(referralPanel, /supabase\.rpc\('get_referral_program_settings_v2'\)/);
  assert.match(referralPanel, /Number\(row\.reward_amount\)/);
  assert.match(settingsPanel, /p_base_reward_amount:\s*baseReward/);
  assert.match(settingsPanel, /p_event_reward_amount:\s*eventReward/);
  assert.match(referralPanel, /referral-program-settings/);
  assert.match(referralPanel, /\.on\('broadcast', \{ event: 'updated' \}, scheduleRefresh\)/);
});

test('notification navigation uses the blue reference badge without changing unread-count sources', async () => {
  const appLayout = await readFile(new URL('../src/components/layout/AppLayout.tsx', import.meta.url), 'utf8');
  const mobileNav = await readFile(new URL('../src/components/layout/MobileNavigationOverride.tsx', import.meta.url), 'utf8');
  assert.match(appLayout, /to === '\/notifications' \? 'bg-\[#3B82F6\]/);
  assert.match(mobileNav, /key === 'notifications' \? 'bg-\[#3B82F6\]/);
  assert.match(appLayout, /liveUnreadNotifications/);
  assert.match(mobileNav, /unreadNotificationCount/);
});


test('legacy manual referral registration uses the same scheduled campaign reward', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20261101053603_referral_campaign_legacy_registration_reward.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.register_for_competition\(/);
  assert.match(migration, /v_referral_reward_amount integer/);
  assert.match(migration, /s\.event_reward_amount/);
  assert.match(migration, /s\.base_reward_amount/);
  assert.match(migration, /s\.is_active = true/);
  assert.match(migration, /v_referral_reward_amount,\s*'PENDING'/);
  assert.doesNotMatch(migration, /\n\s*5,\s*'PENDING'/);
  assert.match(migration, /ON CONFLICT \(referred_user_id\) DO NOTHING/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.register_for_competition\(uuid, text, uuid, text, boolean, text, text, text\) FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.register_for_competition\(uuid, text, uuid, text, boolean, text, text, text\) TO authenticated/);
});


test('admin referral campaign updates broadcast an invalidation event without publishing private settings', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20261101053920_referral_campaign_realtime_invalidation.sql', import.meta.url), 'utf8');
  assert.match(migration, /PERFORM realtime\.send\(/);
  assert.match(migration, /jsonb_build_object\('updated_at', v_row\.updated_at\)/);
  assert.match(migration, /'referral-program-settings'/);
  assert.match(migration, /'updated'/);
  assert.match(migration, /false\s*\)/);
  assert.doesNotMatch(migration, /jsonb_build_object\([^)]*reward_amount/s);
});


test('notifications visual contract follows the supplied Font Awesome reference and single global header', async () => {
  const notificationsPage = await readFile(new URL('../src/pages/NotificationsPage.tsx', import.meta.url), 'utf8');
  const globalHeader = await readFile(new URL('../src/components/layout/GlobalHeader.tsx', import.meta.url), 'utf8');
  const appLayout = await readFile(new URL('../src/components/layout/AppLayout.tsx', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

  assert.doesNotMatch(html, /font-awesome\/6\.4\.0\/css\/all\.min\.css/);
  assert.match(notificationsPage, /cdnjs\.cloudflare\.com\/ajax\/libs\/font-awesome\/6\.4\.0\/css\/all\.min\.css/);
  const referralPanel = await readFile(new URL('../src/components/referrals/ReferralProgramPanel.tsx', import.meta.url), 'utf8');
  assert.match(referralPanel, /cdnjs\.cloudflare\.com\/ajax\/libs\/font-awesome\/6\.4\.0\/css\/all\.min\.css/);
  assert.match(referralPanel, /fa-gift/);
  assert.match(referralPanel, /fa-coins/);
  assert.match(referralPanel, /text-\[#34D399\]/);
  assert.match(appLayout, /max-w-\[1440px\] mx-auto flex surface-bg/);
  assert.doesNotMatch(appLayout, /location\.pathname === '\/notifications' \? 'w-full'/);
  assert.match(notificationsPage, /notification-modal-panel[^"]*max-w-lg/);
  assert.doesNotMatch(notificationsPage, /notification-modal-backdrop/);
  const styles = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.doesNotMatch(styles, /\.notifications-modal-backdrop/);
  assert.match(globalHeader, /location\.pathname === '\/notifications'/);
  assert.match(globalHeader, /Notifikasi/);
  const notificationsHeaderStart = globalHeader.indexOf("if (location.pathname === '/notifications')");
  const notificationsHeaderEnd = globalHeader.indexOf("  return (", notificationsHeaderStart);
  const notificationsHeader = globalHeader.slice(notificationsHeaderStart, notificationsHeaderEnd);
  assert.ok(notificationsHeaderStart >= 0 && notificationsHeaderEnd > notificationsHeaderStart);
  assert.doesNotMatch(notificationsHeader, /Program Referral/);
  assert.match(globalHeader, /Daily Tasks &amp; Program Referral/);
  assert.match(notificationsPage, /fa-users-rays/);
  assert.match(notificationsPage, /fa-coins/);
  assert.match(notificationsPage, /fa-award/);
  assert.match(notificationsPage, /fa-circle-check/);
  assert.match(notificationsPage, /notification-modal-footer/);
  assert.doesNotMatch(notificationsPage, /Kabar akun, aktivitas, dan undangan komunitasmu/);
});


test('notifications follow the expanded reference categories and dynamic previews', async () => {
  const page = await readFile(new URL('../src/pages/NotificationsPage.tsx', import.meta.url), 'utf8');

  assert.match(page, /key: 'gamification'/);
  assert.match(page, /key: 'winner'/);
  assert.match(page, /key: 'announcement'/);
  assert.match(page, /fa-gamepad/);
  assert.match(page, /fa-trophy/);
  assert.match(page, /fa-bullhorn/);
  assert.match(page, /selectedCategory === 'winner'/);
  assert.match(page, /selectedCategory === 'gamification'/);
  assert.match(page, /selectedCategory === 'announcement'/);
});

test('Daily Tasks owns the referral tab and keeps the full referral panel', async () => {
  const daily = await readFile(new URL('../src/pages/DailyTasksPage.tsx', import.meta.url), 'utf8');
  const notifications = await readFile(new URL('../src/pages/NotificationsPage.tsx', import.meta.url), 'utf8');

  assert.match(daily, /ReferralProgramPanel/);
  assert.match(daily, /tab-tasks-btn/);
  assert.match(daily, /tab-referral-btn/);
  assert.match(daily, /useSearchParams/);
  assert.match(daily, /duration-300/);
  assert.doesNotMatch(notifications, /ReferralProgramPanel/);
  assert.doesNotMatch(notifications, /notifications-tab-shell/);
  assert.doesNotMatch(notifications, /activeTab/);
  assert.match(notifications, /notifications-promo/);
  assert.match(notifications, /daily-tasks\?tab=referral/);
});

test('Daily Tasks streak tracker derives seven-day progress from stored check-in history', async () => {
  const daily = await readFile(new URL('../src/pages/DailyTasksPage.tsx', import.meta.url), 'utf8');

  assert.match(daily, /daily-checkin-streak-tracker/);
  assert.match(daily, /lastCheckin/);
  assert.match(daily, /streak_day/);
  assert.match(daily, /checkin_date/);
  assert.match(daily, /Array\.from\(\{ length: 7 \}/);
  assert.match(daily, /Siap Klaim/);
  assert.doesNotMatch(daily, /Streak: <strong[^>]*>5 Hari/);
});

test('notification mark-all-read control is placed immediately before the filter label', async () => {
  const page = await readFile(new URL('../src/pages/NotificationsPage.tsx', import.meta.url), 'utf8');
  const markRead = page.indexOf('Tandai semua dibaca');
  const filterLabel = page.indexOf('Filter:');

  assert.ok(markRead >= 0 && filterLabel > markRead);
  assert.match(page, /fa-check-double/);
  assert.match(page, /markAllNotificationsRead/);
});

test('referral settings expose custom milestone tiers and editable notifications promo content', async () => {
  const panel = await readFile(new URL('../src/components/referrals/ReferralProgramPanel.tsx', import.meta.url), 'utf8');
  const settings = await readFile(new URL('../src/components/admin/ReferralSettingsPanel.tsx', import.meta.url), 'utf8');

  assert.match(panel, /get_referral_program_settings_v2/);
  assert.match(panel, /milestone_tiers/);
  assert.match(panel, /promo_title/);
  assert.match(panel, /promo_description/);
  assert.match(settings, /admin_update_referral_program_settings_v2/);
  assert.match(settings, /p_milestone_tiers/);
  assert.match(settings, /p_promo_title/);
  assert.match(settings, /p_promo_description/);
  assert.match(settings, /p_promo_badge/);
  assert.match(settings, /p_promo_cta/);
  assert.match(settings, /bonus_amount/);
  assert.match(settings, /display_amount/);
});

test('referral tier bonuses are credited once through the protected ledger trigger', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20261101090000_referral_milestone_payouts_and_custom_promo.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS private\.referral_tier_awards/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION private\.apply_referral_milestone_rewards/);
  assert.match(migration, /AFTER INSERT ON public\.edu_coin_ledger/);
  assert.match(migration, /REFERRAL_REGISTRATION/);
  assert.match(migration, /REFERRAL_TIER_BONUS/);
  assert.match(migration, /ON CONFLICT \(referrer_user_id, milestone_target\) DO NOTHING/);
  assert.match(migration, /ON CONFLICT \(user_id, event_type, event_id\) DO NOTHING/);
  assert.match(migration, /private\.current_user_is_admin\(\)/);
  assert.match(migration, /REVOKE ALL ON TABLE private\.referral_tier_awards FROM PUBLIC, anon, authenticated, service_role/);
});

test('referral tier defaults match all four configured milestones from the supplied HTML', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20261101090000_referral_milestone_payouts_and_custom_promo.sql', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../src/components/referrals/ReferralProgramPanel.tsx', import.meta.url), 'utf8');

  assert.ok(panel.indexOf('referral-link-card') < panel.indexOf('referral-reward-tiers'));
  assert.ok(panel.indexOf('referral-reward-tiers') < panel.indexOf('referral-stats'));
  assert.match(migration, /"target":\s*1,[\s\S]*?"display_amount":\s*"5 Coin"/);
  assert.match(migration, /"target":\s*25,[\s\S]*?"display_amount":\s*"145 Coin"[\s\S]*?"bonus_amount":\s*20/);
  assert.match(migration, /"target":\s*100,[\s\S]*?"display_amount":\s*"650 Coin"[\s\S]*?"bonus_amount":\s*150/);
  assert.match(migration, /"target":\s*1000,[\s\S]*?"display_amount":\s*"950 Coin"[\s\S]*?"bonus_amount":\s*250[\s\S]*?"tag":\s*"ULTRA"/);
  assert.match(panel, /successful >= milestone\.target/);
  assert.match(panel, /milestone\.display_amount/);
});

test('referral statistics match the reference icon-left layout and sit before the instructions', async () => {
  const panel = await readFile(new URL('../src/components/referrals/ReferralProgramPanel.tsx', import.meta.url), 'utf8');
  const statsStart = panel.indexOf('referral-stats');
  const howItWorks = panel.indexOf('Cara Kerja Referral');
  const stats = panel.slice(statsStart, howItWorks);

  assert.ok(statsStart >= 0 && howItWorks > statsStart);
  assert.match(stats, /flex items-center gap-4/);
  assert.match(stats, /Total Undangan/);
  assert.match(stats, /Berhasil Terverifikasi/);
  assert.match(stats, /Reward Diperoleh/);
  assert.doesNotMatch(stats, /mt-3 text-xl/);
});

test('referral activity table preserves the reference four-column summary', async () => {
  const panel = await readFile(new URL('../src/components/referrals/ReferralProgramPanel.tsx', import.meta.url), 'utf8');
  const activity = panel.slice(panel.indexOf('referral-activity-table'));

  assert.match(activity, /Tanggal Gabung/);
  assert.match(activity, /Hadiah & Status/);
  assert.doesNotMatch(activity, /<th[^>]*>Aktivitas<\/th>/);
  assert.match(panel, /row.status === 'VERIFIED' \|\| row.status === 'CREDITED'/);
  assert.match(panel, /Edu Coin · Selesai/);
});


test('Daily Tasks uses Jakarta calendar dates across the app clock boundary', async () => {
  const helperSource = await readFile(new URL('../src/lib/jakartaDate.ts', import.meta.url), 'utf8');
  const compiledDate = ts.transpileModule(helperSource, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dateModuleUrl = `data:text/javascript;base64,${Buffer.from(compiledDate).toString('base64')}`;
  const { getJakartaDateKey, getPreviousJakartaDateKey } = await import(dateModuleUrl);

  assert.equal(getJakartaDateKey(new Date('2026-10-31T16:59:59.000Z')), '2026-10-31');
  assert.equal(getJakartaDateKey(new Date('2026-10-31T17:00:00.000Z')), '2026-11-01');
  assert.equal(getPreviousJakartaDateKey('2026-11-01'), '2026-10-31');
});

test('Daily Tasks UI and service use the same WIB date key and backend wallet balance', async () => {
  const daily = await readFile(new URL('../src/pages/DailyTasksPage.tsx', import.meta.url), 'utf8');
  const service = await readFile(new URL('../src/services/daily-task.service.ts', import.meta.url), 'utf8');

  assert.match(daily, /getJakartaDateKey/);
  assert.match(daily, /getPreviousJakartaDateKey/);
  assert.match(daily, /select\('edu_coin'\)/);
  assert.doesNotMatch(daily, /toISOString\(\)\.slice\(0,\s*10\)/);
  assert.match(service, /getJakartaDateKey/);
  assert.doesNotMatch(service, /toISOString\(\)\.slice\(0,\s*10\)/);
});

test('daily reward claims update canonical profile balances only when ledger rows are newly inserted', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20261101100000_daily_tasks_wib_wallet_integrity.sql', import.meta.url), 'utf8');
  const walletGuard = await readFile(new URL('../supabase/migrations/20261101110000_profile_currency_client_guard.sql', import.meta.url), 'utf8');

  assert.match(migration, /CREATE OR REPLACE FUNCTION private\.credit_profile_currency/i);
  assert.match(migration, /UPDATE public\.profiles/i);
  assert.match(migration, /total_xp\s*=\s*coalesce\(total_xp,\s*0\)/i);
  assert.match(migration, /edu_coin\s*=\s*coalesce\(edu_coin,\s*0\)/i);
  assert.match(walletGuard, /prevent_profile_currency_client_mutation/);
  assert.match(walletGuard, /PROFILE_CURRENCY_BACKEND_MANAGED/);
  assert.match(walletGuard, /BEFORE INSERT OR UPDATE OF edu_coin, total_xp/);
  assert.match(migration, /RETURNING id INTO v_ledger_id/i);
  assert.match(migration, /IF v_ledger_id IS NOT NULL THEN/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION private\.credit_profile_currency/i);
  assert.match(migration, /p_date IS DISTINCT FROM v_today/i);
  assert.match(migration, /Asia\/Jakarta/i);
  assert.match(migration, /claim_date\s*=\s*v_claim_date/i);
  assert.match(migration, /ON CONFLICT \(user_id, event_type, event_id\) DO NOTHING/i);
  assert.doesNotMatch(migration, /CREATE TRIGGER[^;]+ON public\.edu_coin_ledger/i);
});

test('Daily Tasks visual structure follows the supplied reference without changing the sidebar', async () => {
  const daily = await readFile(new URL('../src/pages/DailyTasksPage.tsx', import.meta.url), 'utf8');
  const header = await readFile(new URL('../src/components/layout/GlobalHeader.tsx', import.meta.url), 'utf8');
  const admin = await readFile(new URL('../src/pages/AdminDailyTaskPage.tsx', import.meta.url), 'utf8');
  const layout = await readFile(new URL('../src/components/layout/AppLayout.tsx', import.meta.url), 'utf8');

  assert.match(daily, /daily-tasks-page/);
  assert.match(daily, /max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8/);
  assert.match(daily, /#0B1120/);
  assert.match(daily, /#151E32/);
  assert.match(daily, /#1E293B/);

  assert.match(daily, /get_daily_checkin_streak_rewards/);
  assert.match(daily, /day_rewards/);
  assert.match(daily, /subscribeSykaEvents/);
  assert.match(daily, /profile-updated/);
  assert.match(daily, /refreshUser/);
  assert.match(daily, /get_daily_checkin_streak_rewards/);
  assert.match(daily, /scheduledReward/);
  assert.match(daily, /historicalDateKey/);
  assert.match(header, /Daily Tasks &(?:amp;)? Program Referral/);
  assert.match(admin, /from\('daily_tasks'\)\.insert/);
  assert.match(admin, /from\('daily_tasks'\)\.update/);
  assert.match(admin, /is_active/);
  assert.match(admin, /VERIFIED_REFERRAL/);
  assert.match(admin, /PROFILE_COMPLETE/);
  assert.match(admin, /DAILY_CHECKIN/);
  assert.match(admin, /Task Mandiri dapat diklaim sendiri/);
  assert.match(layout, /max-w-\[1440px\] mx-auto flex surface-bg/);
});


test('daily task completion is atomic and requires the configured backend evidence', async () => {
  const service = await readFile(new URL('../src/services/daily-task.service.ts', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../supabase/migrations/20261101100000_daily_tasks_wib_wallet_integrity.sql', import.meta.url), 'utf8');

  assert.match(service, /rpc\('claim_and_complete_daily_task'/);
  assert.doesNotMatch(service, /rpc\('claim_daily_task'/);
  assert.match(migration, /private\.is_daily_task_eligible\(u, p_task_id, v_claim_date\)/);
  assert.match(migration, /CHECKIN_DATE_MUST_BE_TODAY/);
  assert.match(migration, /CHECKIN_REWARD_TYPE_NOT_SUPPORTED/);

  assert.match(migration, /get_daily_checkin_streak_rewards/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.ok(migration.includes('LOCK TABLE public.edu_coin_ledger'));
  assert.ok(migration.includes('LOCK TABLE public.xp_ledger'));
});
