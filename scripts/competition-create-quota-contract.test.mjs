import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const createPage = await readFile(
  new URL('../src/pages/OrganizerCompetitionCreatePage.tsx', import.meta.url),
  'utf8',
);

test('draft creation remains available independently from monthly publication quota', () => {
  assert.match(createPage, /create_organizer_competition/);
  assert.match(createPage, /Simpan Draft/);
  assert.doesNotMatch(createPage, /COMPETITION_QUOTA_EXCEEDED/);
  assert.doesNotMatch(createPage, /quotaReached/);
});
