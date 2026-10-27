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
  let roleLookupCount = 0;
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
  let currentUser = { ...user, phone: null as string | null, phone_confirmed_at: null as string | null };
  let workspace: {
    id: string;
    name: string;
    slug: string;
    status: string;
    owner_user_id: string;
    logo_asset_url: string | null;
    created_at: string;
    access_code?: string;
  } | null = null;
  let workspaceJoined = false;
  const expiresAt = 4102444800;
  const tokenPayload = Buffer.from(JSON.stringify({
    sub: userId,
    role: 'authenticated',
    aud: 'authenticated',
    exp: expiresAt,
    iat: 1767225600,
    email,
  })).toString('base64url');
  const accessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + tokenPayload + '.test-signature';
  const profile = {
    id: userId,
    username: 'akun_uji',
    full_name: 'Akun Uji',
    account_type: roles.includes('teacher') ? 'teacher' : roles.includes('organizer_member') ? 'organizer' : 'student',
    status: 'ACTIVE',
    created_at: '2026-01-01T00:00:00.000Z',
  };
  const corsHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'apikey,authorization,content-type,x-client-info,prefer,accept-profile,content-profile',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD',
  };
  const tokenResponse = () => ({
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    refresh_token: 'test-refresh-token',
    user: currentUser,
  });

  await page.route('**/auth/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    if (url.pathname.endsWith('/token') && url.searchParams.get('grant_type') === 'password') {
      await route.fulfill({ status: 200, headers: corsHeaders, contentType: 'application/json', body: JSON.stringify(tokenResponse()) });
      return;
    }
    if (url.pathname.endsWith('/logout')) {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    if (url.pathname.endsWith('/verify') && route.request().method() === 'POST') {
      const payload = route.request().postDataJSON();
      if (payload.type === 'phone_change') {
        currentUser = {
          ...currentUser,
          phone: String(payload.phone ?? currentUser.phone ?? ''),
          phone_confirmed_at: '2026-01-01T00:00:00.000Z',
        };
        await route.fulfill({ status: 200, headers: corsHeaders, contentType: 'application/json', body: JSON.stringify(tokenResponse()) });
        return;
      }
    }
    if (url.pathname.endsWith('/user') && route.request().method() === 'PUT') {
      const payload = route.request().postDataJSON();
      currentUser = { ...currentUser, phone: String(payload.phone ?? currentUser.phone ?? ''), phone_confirmed_at: null };
      await route.fulfill({ status: 200, headers: corsHeaders, contentType: 'application/json', body: JSON.stringify(currentUser) });
      return;
    }
    if (url.pathname.endsWith('/user')) {
      await route.fulfill({ status: 200, headers: corsHeaders, contentType: 'application/json', body: JSON.stringify(currentUser) });
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
      roleLookupCount += 1;
      rows = roles.map((role) => ({ role, is_active: true }));
    } else if (url.pathname.endsWith('/profiles')) {
      rows = [profile];
    } else if (url.pathname.endsWith('/rpc/create_organizer')) {
      const payload = route.request().postDataJSON();
      workspaceJoined = false;
      workspace = {
        id: '22222222-2222-4222-8222-222222222222',
        name: String(payload.p_name),
        slug: String(payload.p_slug),
        status: 'ACTIVE',
        owner_user_id: userId,
        logo_asset_url: null,
        created_at: '2026-01-01T00:00:00.000Z',
        access_code: 'abc123def0',
      };
      rows = [{ id: workspace.id, name: workspace.name, slug: workspace.slug, access_code: workspace.access_code }];
    } else if (url.pathname.endsWith('/rpc/join_organizer')) {
      const payload = route.request().postDataJSON();
      workspaceJoined = true;
      workspace = {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Organisasi Contoh',
        slug: String(payload.p_slug),
        status: 'ACTIVE',
        owner_user_id: '99999999-9999-4999-8999-999999999999',
        logo_asset_url: null,
        created_at: '2026-01-01T00:00:00.000Z',
      };
      rows = [{ organizer_id: workspace.id, name: workspace.name, slug: workspace.slug, role: 'editor' }];
    } else if (url.pathname.endsWith('/organizers')) {
      const ownerFilter = url.searchParams.has('owner_user_id');
      if (workspace && (!workspaceJoined || !ownerFilter)) rows = [workspace];
    } else if (url.pathname.endsWith('/organizer_members')) {
      if (workspace) {
        rows = [{
          organizer_id: workspace.id,
          user_id: userId,
          role: workspaceJoined ? 'editor' : 'owner',
          member_role: workspaceJoined ? 'editor' : 'owner',
          status: 'ACTIVE',
          is_active: true,
          created_at: '2026-01-01T00:00:00.000Z',
        }];
      }
    }
    const total = rows.length;
    await route.fulfill({
      status: 200,
      headers: { ...corsHeaders, 'content-range': total ? '0-' + (total - 1) + '/' + total : '0-0/0' },
      contentType: 'application/json',
      body: JSON.stringify(rows),
    });
  });

  return { roleLookupCount: () => roleLookupCount };
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
    const audit = await mockSupabaseLogin(page, []);
    await page.goto('/login');
    await page.locator('input[autocomplete="email"]').fill('guru@example.test');
    await page.locator('input[autocomplete="current-password"]').fill('SafeTestPassword123!');
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();

    await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
    await expect(page.getByText(/Akun belum memiliki role aktif di backend/i)).toBeVisible({ timeout: 5_000 });
    await expect.poll(() => audit.roleLookupCount()).toBeGreaterThan(0);
    const persistedAuthTokens = await page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.endsWith('-auth-token')));
    expect(persistedAuthTokens).toHaveLength(0);
  });
});

test.describe('organizer workspace after login', () => {
  test('organizer can create a workspace only after phone OTP verification', async ({ page }) => {
    await mockSupabaseLogin(page, ['organizer_member']);
    await page.goto('/login?redirect=%2Forganizer');
    await page.locator('input[autocomplete="email"]').fill('guru@example.test');
    await page.locator('input[autocomplete="current-password"]').fill('SafeTestPassword123!');
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();

    await expect(page).toHaveURL(/\/organizer(?:\?.*)?$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Selesaikan setup organisasi' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Buka Pengaturan Organisasi' })).toHaveCount(0);

    await page.locator('input[autocomplete="organization"]').fill('Organisasi Uji');
    await page.locator('input[placeholder="sma-nusantara"]').fill('organisasi-uji');
    await page.locator('input[type="tel"]').fill('081234567890');
    await expect(page.getByRole('button', { name: 'Buat Workspace' })).toBeDisabled();
    await page.getByRole('button', { name: 'Kirim Kode OTP' }).click();
    await expect(page.getByPlaceholder('Kode OTP 6 digit')).toBeVisible();
    await page.getByPlaceholder('Kode OTP 6 digit').fill('123456');
    await page.getByRole('button', { name: 'Verifikasi OTP' }).click();
    await expect(page.getByText('Nomor telepon berhasil diverifikasi.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Buat Workspace' })).toBeEnabled();

    await page.getByRole('button', { name: 'Buat Workspace' }).click();
    await expect(page.getByRole('heading', { name: 'Workspace berhasil dibuat' })).toBeVisible();
    await expect(page.getByText('abc123def0')).toBeVisible();
    await page.getByRole('button', { name: 'Buka Workspace' }).click();
    await expect(page.getByRole('heading', { name: 'Organisasi Uji' })).toBeVisible({ timeout: 10_000 });
  });

  test('organizer can join an existing workspace with its invitation code', async ({ page }) => {
    await mockSupabaseLogin(page, ['organizer_member']);
    await page.goto('/login?redirect=%2Forganizer');
    await page.locator('input[autocomplete="email"]').fill('guru@example.test');
    await page.locator('input[autocomplete="current-password"]').fill('SafeTestPassword123!');
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();

    await expect(page).toHaveURL(/\/organizer(?:\?.*)?$/, { timeout: 15_000 });
    await page.getByRole('button', { name: 'Gabung Organisasi' }).first().click();
    await page.locator('input[placeholder="nama-organisasi"]').fill('organisasi-contoh');
    await page.locator('input[placeholder="Masukkan kode dari pemilik organisasi"]').fill('abc123def0');
    await page.getByRole('button', { name: 'Gabung Organisasi' }).last().click();

    await expect(page.getByRole('heading', { name: 'Berhasil bergabung' })).toBeVisible();
    await page.getByRole('button', { name: 'Buka Workspace' }).click();
    await expect(page.getByRole('heading', { name: 'Organisasi Contoh' })).toBeVisible({ timeout: 10_000 });
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
