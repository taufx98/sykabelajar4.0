import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20261031170000_stage_4_organizer_invitation_membership.sql', import.meta.url),
  'utf8',
);
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
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
  assert.match(migration, /CREATE TRIGGER trg_sync_organizer_member_user_role[\s\S]*AFTER INSERT OR UPDATE OR DELETE ON public\.organizer_members/);
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

test('owner and admin invitation controls rotate server-hashed codes instead of writing the legacy plaintext column', () => {
  assert.match(organizerService, /rpc\('rotate_organizer_access_code'/);
  assert.match(memberPage, /rotateOrganizerAccessCode/);
  assert.match(memberPage, /\/organizer\/join/);
  assert.match(adminPage, /rotateOrganizerAccessCode/);
  assert.doesNotMatch(adminPage, /from\('organizers'\)\.update\(\{\s*access_code/);
  assert.doesNotMatch(adminPage, /org\.access_code/);
});

test('admin console can rotate invitations while workspace owners remain scoped to their own organization', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\\.rotate_organizer_access_code/);
  assert.match(migration, /private\\.current_user_is_admin\\(\\)/);
  assert.match(migration, /private\\.current_user_can_manage_organizer\\(p_organizer_id\\)/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\\.rotate_organizer_access_code\\(uuid\\)\\s+TO authenticated/);
});

test('invitation code is displayed only after a rotation and can be copied from the owner workspace', () => {
  assert.match(memberPage, /Kode undangan/);
  assert.match(memberPage, /navigator\.clipboard\.writeText/);
  assert.match(memberPage, /Kode ini hanya ditampilkan saat dibuat/);
});
