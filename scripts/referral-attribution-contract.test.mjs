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
  assert.match(referralPanel, /supabase\.rpc\('get_referral_program_settings'\)/);
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
  assert.match(globalHeader, /Notifikasi &amp; Program Referral/);
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

test('referral tab keeps the configured Edu Coin badge and highlights its gift icon while active', async () => {
  const page = await readFile(new URL('../src/pages/NotificationsPage.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(page, /activeTab === 'referral'\)\s*\{\s*setReferralPreview\(null\)/);
  assert.match(page, /\}, \[user\?\.id\]\);/);
  assert.match(page, /activeTab === 'referral' \? 'text-white' : 'text-\[#94A3B8\]'/);
  assert.match(page, /\+\{referralPreview\.reward_amount\.toLocaleString\('id-ID'\)\} Edu Coin/);
});

test('notification and referral tab content use a fade and slide transition when switching', async () => {
  const page = await readFile(new URL('../src/pages/NotificationsPage.tsx', import.meta.url), 'utf8');

  assert.match(page, /displayedTab/);
  assert.match(page, /tabContentVisible/);
  assert.match(page, /requestAnimationFrame/);
  assert.match(page, /transition-all duration-300 ease-out/);
});

test('referral tier milestones and their reward figures follow the supplied HTML reference', async () => {
  const panel = await readFile(new URL('../src/components/referrals/ReferralProgramPanel.tsx', import.meta.url), 'utf8');

  assert.ok(panel.indexOf('referral-link-card') < panel.indexOf('referral-reward-tiers'));
  assert.ok(panel.indexOf('referral-reward-tiers') < panel.indexOf('referral-stats'));
  assert.match(panel, /1 User/);
  assert.match(panel, /Target Pertama/);
  assert.match(panel, /5 Coin/);
  assert.match(panel, /25 User/);
  assert.match(panel, /145 Coin/);
  assert.match(panel, /\+20 Bonus/);
  assert.match(panel, /100 User/);
  assert.match(panel, /\+150 Coin Bonus/);
  assert.match(panel, /650 Coin/);
  assert.match(panel, /1\.000 User/);
  assert.match(panel, /ULTRA/);
  assert.match(panel, /\+250 Bonus Coin/);
  assert.match(panel, /950 Coin/);
  assert.match(panel, /700 \+ 250/);
  assert.match(panel, /successful >= milestone\.target/);
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
});
