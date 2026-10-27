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

async function mockSupabaseLogin(page: import('@playwright/test').Page, roles: string[]) {
  const userId = '11111111-1111-4111-8111-111111111111';
  const email = 'guru@example.test';
  const user = {
    id: userId,
    aud: 'authenticated',
    role: 'authenticated',
    email,
    email_confirmed_at: '2026-01-01T00:00:00.000Z',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  const expiresAt = 4102444800;
  const tokenPayload = Buffer.from(JSON.stringify({
    sub: userId,
    role: 'authenticated',
    aud: 'authenticated',
    exp: expiresAt,
    iat: 1767225600,
    email,
  })).toString('base64url');
  const accessToken = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${tokenPayload}.test-signature`;
  const profile = {
    id: userId,
    username: 'guru_uji',
    full_name: 'Guru Uji',
    account_type: roles.includes('teacher') ? 'teacher' : 'student',
    status: 'ACTIVE',
    created_at: '2026-01-01T00:00:00.000Z',
  };
  const corsHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'apikey,authorization,content-type,x-client-info,prefer,accept-profile,content-profile',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  };

  await page.route('**/auth/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    if (url.pathname.endsWith('/token') && url.searchParams.get('grant_type') === 'password') {
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: accessToken,
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: expiresAt,
          refresh_token: 'test-refresh-token',
          user,
        }),
      });
      return;
    }
    if (url.pathname.endsWith('/logout')) {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    if (url.pathname.endsWith('/user')) {
      await route.fulfill({ status: 200, headers: corsHeaders, contentType: 'application/json', body: JSON.stringify(user) });
      return;
    }
    await route.fulfill({ status: 200, headers: corsHeaders, contentType: 'application/json', body: '{}' });
  });

  await page.route('**/rest/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    let rows: unknown[] = [];
    if (url.pathname.endsWith('/user_roles')) {
      rows = roles.map((role) => ({ role, is_active: true }));
    } else if (url.pathname.endsWith('/profiles')) {
      rows = [profile];
    }
    await route.fulfill({
      status: 200,
      headers: { ...corsHeaders, 'content-range': '0-0/0' },
      contentType: 'application/json',
      body: JSON.stringify(rows),
    });
  });
}

test.describe('backend-authoritative login flow', () => {
  test('active teacher role from Supabase allows the teacher route without a login role picker', async ({ page }) => {
    await mockSupabaseLogin(page, ['teacher']);
    await page.goto('/login?redirect=%2Fguru');
    await page.locator('input[autocomplete="email"]').fill('guru@example.test');
    await page.locator('input[autocomplete="current-password"]').fill('SafeTestPassword123!');
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();

    await expect(page).toHaveURL(/\/guru(?:\?.*)?$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Masuk' })).toHaveCount(0);
  });

  test('account without an active backend role is rejected instead of falling back to student', async ({ page }) => {
    await mockSupabaseLogin(page, []);
    await page.goto('/login');
    await page.locator('input[autocomplete="email"]').fill('guru@example.test');
    await page.locator('input[autocomplete="current-password"]').fill('SafeTestPassword123!');
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();

    await expect(page.getByText(/Akun belum memiliki role aktif di backend/i)).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
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
