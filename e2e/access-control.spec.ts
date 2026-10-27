import { test, expect } from '@playwright/test';

const protectedRoutes = [
  '/home',
  '/pesan',
  '/guru',
  '/organizer',
  '/admin',
];

async function completeRegistrationDetails(page: import('@playwright/test').Page, role: 'Pelajar' | 'Guru' | 'Penyelenggara') {
  await page.goto('/register');
  await page.locator('input[type="email"]').fill('registration-flow@example.test');
  const passwords = page.locator('input[type="password"]');
  await passwords.nth(0).fill('SafeTestPassword123!');
  await passwords.nth(1).fill('SafeTestPassword123!');
  await page.getByRole('button', { name: 'Lanjut', exact: true }).click();

  if (role !== 'Pelajar') {
    await page.getByRole('button', { name: role, exact: true }).click();
  }

  const textInputs = page.locator('input:not([type]), input[type="text"]');
  await textInputs.nth(0).fill('Akun Uji');
  await textInputs.nth(1).fill('akun_uji_flow');
  await page.locator('input[type="date"]').fill('2000-01-01');
  await textInputs.nth(2).fill('Sekolah Uji');
  return page.getByRole('button', { name: 'Lanjut', exact: true });
}

test.describe('registration role validation', () => {
  test('student must choose an education level shown in the form', async ({ page }) => {
    const nextButton = await completeRegistrationDetails(page, 'Pelajar');
    await expect(page.locator('select')).toBeVisible();
    await expect(nextButton).toBeDisabled();
    await page.locator('select').selectOption({ index: 1 });
    await expect(nextButton).toBeEnabled();
  });

  test('teacher can continue without a hidden education-level field', async ({ page }) => {
    const nextButton = await completeRegistrationDetails(page, 'Guru');
    await expect(page.locator('select')).toHaveCount(0);
    await expect(nextButton).toBeEnabled();
  });

  test('organizer can continue without a hidden education-level field', async ({ page }) => {
    const nextButton = await completeRegistrationDetails(page, 'Penyelenggara');
    await expect(page.locator('select')).toHaveCount(0);
    await expect(nextButton).toBeEnabled();
  });
});

test.describe('public entry points', () => {
  test('landing page renders', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toContainText('sykabelajar', { timeout: 10_000 });
  });

  test('login detects the account role from backend and keeps collective participant access', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Masuk' })).toBeVisible();
    await expect(page.getByText(/mengenali peran akun secara otomatis dari backend/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pelajar' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Guru' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Penyelenggara' })).toHaveCount(0);
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
