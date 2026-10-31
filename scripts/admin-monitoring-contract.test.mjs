import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile('supabase/migrations/20261101100000_stage_6_admin_monitoring_investigations.sql', 'utf8');
const page = await readFile('src/pages/AdminMonitoringPage.tsx', 'utf8');
const app = await readFile('src/App.tsx', 'utf8');
const nav = await readFile('src/components/admin/AdminModuleNav.tsx', 'utf8');

test('admin monitoring RPCs are admin-only, bounded and exclude preview attempts', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.admin_get_monitoring_dashboard/i);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.admin_get_attempt_investigation/i);
  assert.match(migration, /private\.current_user_is_admin\(\)/i);
  assert.match(migration, /coalesce\(a\.is_preview, false\) = false/i);
  assert.match(migration, /LEAST\(GREATEST\(coalesce\(p_limit, 25\), 1\), 100\)/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.admin_get_monitoring_dashboard/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_get_monitoring_dashboard/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.admin_get_attempt_investigation/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_get_attempt_investigation/i);
});

test('investigation evidence is read-only and does not expose answers or preview sessions', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION private\.audit_attempt_result_snapshot/i);
  assert.match(migration, /CREATE TRIGGER trg_audit_attempt_result_snapshot/i);
  assert.match(migration, /exam_attempt_events/i);
  assert.match(migration, /attempt\.result_snapshot_changed/i);
  assert.match(page, /admin_get_monitoring_dashboard/);
  assert.match(page, /admin_get_attempt_investigation/);
  assert.doesNotMatch(page, /get_linear_exam_activity/);
  assert.doesNotMatch(migration, /FROM public\.answers/i);
});

test('admin monitoring is routed behind the admin role and linked from admin navigation', () => {
  assert.match(app, /path="\/admin\/monitoring" element={<RoleRoute role="admin"><AdminMonitoringPage \/><\/RoleRoute>} \/>/);
  assert.match(nav, /\/admin\/monitoring/);
  assert.match(page, /Ekspor CSV/);
  assert.match(page, /bukan bukti kecurangan/i);
});
