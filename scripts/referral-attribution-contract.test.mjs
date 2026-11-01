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
});

test('notification navigation uses the blue reference badge without changing unread-count sources', async () => {
  const appLayout = await readFile(new URL('../src/components/layout/AppLayout.tsx', import.meta.url), 'utf8');
  const mobileNav = await readFile(new URL('../src/components/layout/MobileNavigationOverride.tsx', import.meta.url), 'utf8');
  assert.match(appLayout, /to === '\/notifications' \? 'bg-\[#3B82F6\]/);
  assert.match(mobileNav, /key === 'notifications' \? 'bg-\[#3B82F6\]/);
  assert.match(appLayout, /liveUnreadNotifications/);
  assert.match(mobileNav, /unreadNotificationCount/);
});
