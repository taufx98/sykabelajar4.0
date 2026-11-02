import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const createPage = await readFile(
  new URL('../src/pages/OrganizerCompetitionCreatePage.tsx', import.meta.url),
  'utf8',
);

test('competition creation quota errors are explained and link to organizer plan management', () => {
  assert.match(createPage, /COMPETITION_QUOTA_EXCEEDED/);
  assert.match(createPage, /Kuota pembuatan lomba/);
  assert.match(createPage, /\/organizer\/plan/);
});
