import { test, expect } from '@playwright/test';

const protectedRoutes = [
  '/home',
  '/guru',
  '/organizer',
  '/admin',
];

test.describe('public entry points', () => {
  test('landing page renders', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toContainText('sykabelajar', { timeout: 10_000 });
  });

  test('login page exposes all supported account roles', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Masuk' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pelajar' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Guru' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Penyelenggara' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Masuk sebagai Peserta Kolektif/ })).toBeVisible();
  });

  test('collective participant portal login renders', async ({ page }) => {
    await page.goto('/peserta-kolektif/login');
    await expect(page.getByRole('heading', { name: 'Portal Peserta' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Masuk ke portal' })).toBeVisible();
  });
});

test.describe('unauthenticated access control', () => {
  for (const route of protectedRoutes) {
    test(`${route} redirects to login`, async ({ page }) => {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/login\?redirect=/, { timeout: 15_000 });
      await expect(page.getByRole('heading', { name: 'Masuk' })).toBeVisible();
    });
  }
});
