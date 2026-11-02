import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20261102013000_competition_public_roster_and_participant_detail.sql', import.meta.url),
  'utf8',
);
const organizerConfig = await readFile(new URL('../src/pages/OrganizerCompetitionConfigPage.tsx', import.meta.url), 'utf8');
const competitionDetail = await readFile(new URL('../src/pages/CompetitionDetailPage.tsx', import.meta.url), 'utf8');
const resultsPage = await readFile(new URL('../src/pages/CompetitionResultsPage.tsx', import.meta.url), 'utf8');
const resultsService = await readFile(new URL('../src/services/competitionResults.service.ts', import.meta.url), 'utf8');
const socialService = await readFile(new URL('../src/services/social.service.ts', import.meta.url), 'utf8');
const comments = await readFile(new URL('../src/components/ui/Comments.tsx', import.meta.url), 'utf8');
const adminOperations = await readFile(new URL('../src/pages/AdminOperationsPage.tsx', import.meta.url), 'utf8');

test('organizer can configure an optional minimum target separately from the enforced maximum', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS minimum_participants integer/i);
  assert.match(migration, /MINIMUM_EXCEEDS_MAXIMUM/);
  assert.match(migration, /minimum_participants = excluded\.minimum_participants/i);
  assert.match(organizerConfig, /minimum_participants/);
  assert.match(organizerConfig, /max_participants/);
  assert.match(organizerConfig, /minimum.*maksimum|maksimum.*minimum/i);
  assert.match(migration, /r\.max_participants/i);
  assert.doesNotMatch(migration, /IF v_minimum[^;]*RAISE EXCEPTION 'REGISTRATION_CLOSED'/i);
});

test('public participant roster exposes canonical participant fields only for public competitions', () => {
  assert.match(migration, /FUNCTION public\.get_public_competition_participants/i);
  assert.match(migration, /c\.visibility = 'PUBLIC'/);
  assert.match(migration, /public\.participants p[\s\S]*left join public\.schools s/i);
  assert.match(migration, /'full_name', p\.full_name/);
  assert.match(migration, /'class_name', p\.class_name/);
  assert.match(migration, /'school_name', s\.name/);
  assert.doesNotMatch(
    migration.match(/create or replace function public\.get_public_competition_participants[\s\S]*?\$function\$;/i)?.[0] ?? '',
    /social_proof_url|answer_json|answer_key_snapshot|user_id/,
  );
  assert.match(migration, /'quota_count', v_quota_count/);
  assert.match(migration, /'minimum_participants', v_minimum/);
  const roster = migration.match(/create or replace function public\.get_public_competition_participants[\s\S]*?\$function\$;/i)?.[0] ?? '';
  assert.match(roster, /'rank', official_result\.rank_position/);
  assert.match(roster, /'score', official_result\.score/);
  assert.match(roster, /v_comp\.status::text in \('RESULT_PUBLISHED', 'ARCHIVED'\)/);
  assert.match(competitionDetail, /Peringkat/);
  assert.match(competitionDetail, /participant\.score/);
  assert.match(competitionDetail, /\?participant=/);
  assert.match(resultsPage, /useSearchParams/);
  assert.match(resultsPage, /searchParams\.get\('participant'\)/);
});

test('participant result detail is gated by publication or organizer/admin access and excludes raw answers', () => {
  const detail = migration.match(/create or replace function public\.get_competition_participant_detail[\s\S]*?\$function\$;/i)?.[0] ?? '';
  assert.match(detail, /'RESULT_PUBLISHED', 'ARCHIVED'/);
  assert.match(detail, /private\.current_user_is_admin\(\)/);
  assert.match(detail, /private\.current_user_can_edit_competition/);
  assert.match(detail, /a\.is_preview = false/);
  assert.match(detail, /a\.status::text = 'FINALIZED'/);
  assert.match(detail, /evaluate_linear_preview_answer/);
  assert.match(detail, /'correct', v_correct/);
  assert.match(detail, /'incorrect', v_incorrect/);
  assert.match(detail, /duration_seconds/);
  assert.match(detail, /cert\.status::text = 'PUBLISHED'/);
  assert.doesNotMatch(detail, /'answer',|answer_json->|answer_key_snapshot->/);
});

test('participant details in the public results UI are fetched from the canonical result RPC', () => {
  assert.match(resultsService, /get_competition_participant_detail/);
  assert.match(resultsService, /participant_id/);
  assert.match(resultsPage, /Detail Peserta/);
  assert.match(resultsPage, /correct/);
  assert.match(resultsPage, /incorrect/);
  assert.match(resultsPage, /duration_seconds/);
});

test('comment reporting is persisted through an authenticated RPC and comment sharing uses the clipboard', () => {
  assert.match(migration, /FUNCTION public\.report_competition_comment/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.report_competition_comment\(uuid, text\) TO authenticated/i);
  assert.match(socialService, /report_competition_comment/);
  assert.match(comments, /reportPostComment/);
  assert.match(comments, /navigator\.clipboard/);
  assert.match(comments, /Laporkan/);
  assert.match(adminOperations, /resolveReport\(r\.id,'DISMISSED'\)/);
  assert.doesNotMatch(adminOperations, /resolveReport\(r\.id,'REJECTED'\)/);
});
