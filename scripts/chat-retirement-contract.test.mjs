import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('legacy chat URLs redirect and no chat page or admin route is mounted', async () => {
  const app = await read('../src/App.tsx');
  assert.ok(app.includes('path="/pesan" element={<RetiredChatRedirect />}'));
  assert.ok(app.includes("Boolean(window.sessionStorage.getItem('syka_collective_portal_token'))"));
  assert.ok(app.includes("? '/peserta-kolektif'"));
  assert.ok(app.includes("Boolean(window.sessionStorage.getItem('syka_collective_access_token'))"));
  for (const retired of ['MessagesEntryPage', 'MessagesPage', 'CollectiveMessagesPage', 'AdminChatConsolePage', 'ChatUXBridge', 'path="/admin/chat"']) {
    assert.equal(app.includes(retired), false, 'retired route/reference remains: ' + retired);
  }
});

test('follow and comment functionality is owned by the social service', async () => {
  const social = await read('../src/services/social.service.ts');
  const profile = await read('../src/pages/ProfilePage.tsx');
  const followers = await read('../src/pages/FollowersPage.tsx');
  const notifications = await read('../src/pages/NotificationsPage.tsx');
  const profileSettings = await read('../src/pages/ProfileSettingsPage.tsx');
  for (const method of ['getFollowStatus', 'requestFollow', 'respondFollowRequest', 'removeFollow']) {
    assert.ok(social.includes('export async function ' + method + '('), 'missing social method: ' + method);
  }
  assert.ok(social.includes('export async function addPostComment('), 'comment creation must remain available');
  assert.doesNotMatch(profileSettings, /Sosial & Pesan|#blocked|Pengguna Diblokir/);
  for (const source of [profile, followers, notifications]) {
    assert.equal(source.includes('@/services/chat.service'), false);
  }
});

test('app shell and collective features no longer expose or subscribe to chat', async () => {
  const [layout, mobileNav, realtimeHub, teacherMonitor, portal] = await Promise.all([
    read('../src/components/layout/AppLayout.tsx'),
    read('../src/components/layout/MobileNavigationOverride.tsx'),
    read('../src/lib/realtimeHub.ts'),
    read('../src/pages/GuruCollectiveMonitoringPage.tsx'),
    read('../src/pages/CollectiveParticipantPortalPage.tsx'),
  ]);
  for (const [name, source] of Object.entries({ layout, mobileNav, realtimeHub, teacherMonitor, portal })) {
    for (const retired of ['chat.service', 'chat_threads', 'chat_messages', 'collective_chat_messages', '/pesan', 'MessageCircle', 'unreadChatCount']) {
      assert.equal(source.includes(retired), false, name + ' still contains ' + retired);
    }
  }
  assert.ok(teacherMonitor.includes('listTeacherCollectiveParticipants'));
  assert.ok(portal.includes('getCollectiveParticipantResult'));
});

test('backend retirement revokes chat access and preserves historical data', async () => {
  const migration = await read('../supabase/migrations/20261105120000_retire_chat_system.sql');
  assert.match(migration, /revoke all privileges on table/i);
  assert.match(migration, /revoke execute on function/i);
  assert.match(migration, /p\.oid::regprocedure as signature/i);
  assert.match(migration, /alter publication supabase_realtime drop table/i);
  assert.match(migration, /drop trigger if exists trg_referral_activity_chat/i);
  assert.doesNotMatch(migration, /^\\s*drop\\s+table\\b|^\\s*truncate\\s+table\\b/im);
});
