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
  const adminProfileId = '88888888-8888-4888-8888-888888888888';
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
    if (url.pathname.endsWith('/rpc/load_my_threads')) {
      rows = [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          thread_type: 'dm',
          user_id: userId,
          participant_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          status: 'open',
          created_at: '2026-10-01T00:00:00.000Z',
          last_message_at: '2026-10-30T00:00:00.000Z',
          last_message: 'Pesan terbaru',
          unread_count: 0,
          user_name: 'Akun Uji',
          username: 'akun_uji',
          other_user_name: 'Percakapan Aktif',
          other_username: 'chat_aktif',
        },
        {
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          thread_type: 'dm',
          user_id: userId,
          participant_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          status: 'closed',
          created_at: '2026-09-04T00:00:00.000Z',
          last_message_at: '2026-09-04T00:00:00.000Z',
          last_message: 'Pesan lama',
          unread_count: 0,
          user_name: 'Akun Uji',
          username: 'akun_uji',
          other_user_name: 'Percakapan Lama',
          other_username: 'chat_lama',
        },
      ];
    } else if (url.pathname.endsWith('/rpc/is_public_profile_admin')) {
      const payload = route.request().postDataJSON();
      const targetId = String(payload.p_profile_id ?? '');
      const isAdmin = targetId === adminProfileId || (targetId === userId && roles.includes('admin'));
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        contentType: 'application/json',
        body: JSON.stringify(isAdmin),
      });
      return;
    }
    if (url.pathname.endsWith('/user_roles')) {
      roleLookupCount += 1;
      rows = roles.map((role) => ({ role, is_active: true }));
    } else if (url.pathname.endsWith('/profiles')) {
      const requestedUsername = url.searchParams.get('username');
      rows = requestedUsername === 'eq.admin_resmi'
        ? [{
            id: adminProfileId,
            username: 'admin_resmi',
            full_name: 'Admin Resmi',
            account_type: 'student',
            avatar_url: null,
            cover_url: null,
            is_public: true,
          }]
        : [profile];
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

test.describe('chat inbox history visibility', () => {
  test('closed direct-message history is not listed in the private inbox', async ({ page }) => {
    await mockSupabaseLogin(page, ['student']);
    await page.goto('/login?redirect=%2Fpesan');
    await page.locator('input[autocomplete="email"]').fill('guru@example.test');
    await page.locator('input[autocomplete="current-password"]').fill('SafeTestPassword123!');
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();

    await expect.poll(() => new URL(page.url()).pathname).toBe('/pesan');
    await expect(page.locator('aside').getByText('Percakapan Aktif', { exact: true })).toBeVisible();
    await expect(page.getByText('Percakapan Lama', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/History\s*·\s*1/)).toHaveCount(0);
  });
});

test.describe('chat message history pagination and cache', () => {
  test('loads 20 recent messages, fetches older messages in 50-message pages, and reuses the complete local cache', async ({ page }) => {
    await mockSupabaseLogin(page, ['student']);
    const userId = '11111111-1111-4111-8111-111111111111';
    const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const threadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const allMessages = Array.from({ length: 120 }, (_, index) => ({
      id: 'eeeeeeee-eeee-4eee-8eee-' + String(index + 1).padStart(12, '0'),
      thread_id: threadId,
      sender_id: index % 2 === 0 ? otherId : userId,
      body: 'Isi pesan ' + String(index + 1).padStart(3, '0'),
      created_at: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
    }));
    const pageRequests: Array<{ limit: number; before: string | null }> = [];

    await page.route('**/rest/v1/rpc/get_chat_messages_page', async (route) => {
      const payload = route.request().postDataJSON() as { p_limit?: number; p_before?: string | null };
      const limit = Number(payload.p_limit ?? 50);
      const before = payload.p_before ?? null;
      pageRequests.push({ limit, before });
      const rows = allMessages
        .filter((message) => !before || message.created_at < before)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit);
      await route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': '*', 'content-range': rows.length ? '0-' + (rows.length - 1) + '/' + rows.length : '0-0/0' },
        contentType: 'application/json',
        body: JSON.stringify(rows),
      });
    });

    await page.goto('/login?redirect=%2Fpesan');
    await page.locator('input[autocomplete="email"]').fill('guru@example.test');
    await page.locator('input[autocomplete="current-password"]').fill('SafeTestPassword123!');
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/pesan');

    const chatContainer = page.getByTestId('chat-message-list');
    const renderedMessages = chatContainer.getByTestId('chat-message');
    await expect(chatContainer).toBeVisible();
    await expect.poll(() => pageRequests.length).toBe(1);
    expect(pageRequests[0].limit).toBe(20);
    await expect(renderedMessages).toHaveCount(20);

    await chatContainer.evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await expect.poll(() => pageRequests.length).toBe(2);
    expect(pageRequests[1].limit).toBe(50);
    await expect(renderedMessages).toHaveCount(70);

    await chatContainer.evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await expect.poll(() => pageRequests.length).toBe(3);
    expect(pageRequests[2].limit).toBe(50);
    await expect(renderedMessages).toHaveCount(120);

    await chatContainer.evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await expect.poll(() => pageRequests.length).toBe(4);
    expect(pageRequests[3].limit).toBe(50);
    await expect.poll(() => page.getByTestId('chat-message-list').getByTestId('chat-message').count()).toBe(120);

    await page.reload();
    const cachedContainer = page.getByTestId('chat-message-list');
    const cachedMessages = cachedContainer.getByTestId('chat-message');
    await expect(cachedMessages).toHaveCount(20);
    for (const expectedCount of [70, 120, 120]) {
      await cachedContainer.evaluate((element) => {
        element.scrollTop = 0;
        element.dispatchEvent(new Event('scroll', { bubbles: true }));
      });
      await expect(cachedMessages).toHaveCount(expectedCount);
    }
    expect(pageRequests).toHaveLength(4);
  });
});

test.describe('backend-authoritative login flow', () => {
  test('active teacher role from Supabase allows the teacher route without a login role picker', async ({ page }) => {
    await mockSupabaseLogin(page, ['teacher']);
    await page.goto('/login?redirect=%2Fguru');
    await page.locator('input[autocomplete="email"]').fill('guru@example.test');
    await page.locator('input[autocomplete="current-password"]').fill('SafeTestPassword123!');
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();

    await expect(page).toHaveURL(/\/guru(?:\?.*)?$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Masuk' })).toHaveCount(0);
    await expect(page.locator('aside').getByText('Fitur Guru', { exact: true })).toBeVisible();
    await expect(page.locator('aside').getByText('Umum', { exact: true })).toHaveCount(0);
  });

  test('active admin role shows the special-feature divider without a general section label', async ({ page }) => {
    await mockSupabaseLogin(page, ['admin']);
    await page.goto('/login?redirect=%2Fadmin');
    await page.locator('input[autocomplete="email"]').fill('guru@example.test');
    await page.locator('input[autocomplete="current-password"]').fill('SafeTestPassword123!');
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();

    await expect(page).toHaveURL(/\/admin(?:\?.*)?$/, { timeout: 15_000 });
    await expect(page.locator('aside').getByText('Manajemen', { exact: true })).toBeVisible();
    await expect(page.locator('aside').getByText('Umum', { exact: true })).toHaveCount(0);
  });

  test('administrator profile shows full details to its owner and a minimal visitor preview', async ({ page }) => {
    await mockSupabaseLogin(page, ['admin']);
    await page.goto('/login?redirect=%2Fprofile%2Fakun_uji');
    await page.locator('input[autocomplete="email"]').fill('guru@example.test');
    await page.locator('input[autocomplete="current-password"]').fill('SafeTestPassword123!');
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();

    await expect(page).toHaveURL(/\/profile\/akun_uji(?:\?.*)?$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Akun Uji' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Tentang', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Akses Admin', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Prestasi', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Lomba', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Statistik', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /Pusat Admin/ })).toBeVisible();
    await page.getByRole('tab', { name: 'Statistik', exact: true }).click();
    await expect(page.getByText('Edu Coin', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Tampilan Pengunjung', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Tentang', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Akses Admin', exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Prestasi', exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Lomba', exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Statistik', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Pusat Admin/ })).toHaveCount(0);
    await expect(page.getByText('Pendidikan', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Kategori Favorit', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Kembali ke Tampilan Pemilik', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Akses Admin', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Prestasi', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /Pusat Admin/ })).toBeVisible();

    await page.getByRole('tab', { name: 'Akses Admin', exact: true }).click();
    await expect(page.getByRole('link', { name: /Monitoring Sistem/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Verifikasi Pesanan/ })).toBeVisible();
  });

  test('ordinary users see a minimal admin profile without internal admin shortcuts', async ({ page }) => {
    await mockSupabaseLogin(page, ['student']);
    await page.goto('/login?redirect=%2Fprofile%2Fadmin_resmi');
    await page.locator('input[autocomplete="email"]').fill('guru@example.test');
    await page.locator('input[autocomplete="current-password"]').fill('SafeTestPassword123!');
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();

    await expect(page).toHaveURL(/\/profile\/admin_resmi(?:\?.*)?$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Admin Resmi' })).toBeVisible();
    await expect(page.getByText('Administrator', { exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Tentang', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Akses Admin', exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Prestasi', exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Lomba', exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Statistik', exact: true })).toHaveCount(0);
    await expect(page.getByText('Pengikut', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Mengikuti', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ikuti', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Pusat Admin/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Monitoring Sistem/ })).toHaveCount(0);
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
    await expect(page.locator('aside').getByText('Manajemen', { exact: true })).toBeVisible();
    await expect(page.locator('aside').getByText('Umum', { exact: true })).toHaveCount(0);
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

test.describe('Shop editor', () => {
  test('admin product editor shows product information fields and opens a safe duplicate draft', async ({ page }) => {
    await mockSupabaseLogin(page, ['admin']);
    await page.route('**/rest/v1/commerce_products**', async (route) => {
      const rows = [{
        id: '44444444-4444-4444-8444-444444444444',
        code: 'SHOP-EDU-COIN',
        slug: 'paket-edu-coin',
        name: 'Paket Edu Coin',
        short_description: 'Isi saldo Edu Coin',
        description: 'Paket contoh untuk pengujian duplikasi.',
        product_type: 'EDU_COIN_TOPUP',
        audiences: ['student'],
        price: 15000,
        currency: 'IDR',
        image_url: null,
        is_active: true,
        is_featured: true,
        sort_order: 3,
        metadata: { coin_amount: 250 },
      }];
      await route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/1' },
        contentType: 'application/json',
        body: JSON.stringify(rows),
      });
    });
    await page.goto('/login?redirect=%2Fadmin%2Fcore%3Ftab%3Dshop');
    await page.locator('input[autocomplete="email"]').fill('guru@example.test');
    await page.locator('input[autocomplete="current-password"]').fill('SafeTestPassword123!');
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();
    await expect(page).toHaveURL(/admin\/core\?tab=shop$/, { timeout: 15000 });
    await page.route('**/image/upload', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          public_id: 'sykabelajar/shop-products/new/product',
          secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/v123/sykabelajar/shop-products/new/product.png',
          width: 320,
          height: 180,
          version: 123,
          resource_type: 'image',
        }),
      });
    });
    await expect(page.getByRole('button', { name: 'Duplikat Paket Edu Coin', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Duplikat Paket Edu Coin', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Duplikat produk' })).toBeVisible();
    await expect(page.getByLabel('Nama produk')).toHaveValue('Paket Edu Coin (Salinan)');
    await expect(page.getByLabel('Tampilkan di Shop')).not.toBeChecked();
    await expect(page.getByLabel('Jadikan unggulan')).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Simpan salinan' })).toBeVisible();
    await page.getByRole('button', { name: 'Batal', exact: true }).click();

    await page.getByRole('button', { name: 'Tambah produk', exact: true }).click();
    await expect(page.getByLabel('Nama produk')).toBeVisible();
    await expect(page.getByLabel('Harga (Rp)')).toBeVisible();
    await expect(page.locator('[role="dialog"] select').first()).toBeVisible();
    await expect(page.getByText('Unggah gambar', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Tautan gambar')).toHaveCount(0);
    await expect(page.getByText(/semua gambar yang disimpan harus diunggah langsung ke Cloudinary/i)).toBeVisible();
    await page.locator('[role="dialog"] input[type="file"]').setInputFiles({
      name: 'product.png',
      mimeType: 'image/png',
      buffer: Buffer.from('cloudinary-test-image'),
    });
    await expect(page.locator('[role="dialog"] img[src^="https://res.cloudinary.com/test-cloud/image/upload/"]')).toBeVisible();

    const typeSelector = page.locator('[role="dialog"] select').first();
    await typeSelector.selectOption('EDU_COIN_TOPUP');
    await expect(page.getByText('Edu Coin yang diterima pembeli')).toBeVisible();
    await typeSelector.selectOption('BADGE');
    await expect(page.getByText('Badge yang akan diberikan')).toBeVisible();
    await expect(page.getByText(/badge yang diizinkan untuk dijual/i)).toBeVisible();
    await typeSelector.selectOption('CERTIFICATE_SERIALS');
    await expect(page.getByText('Jumlah QR / Serial dalam paket')).toBeVisible();

    await typeSelector.selectOption('DIGITAL_ITEM');
    await page.getByLabel('Nama produk').fill('Paket Latihan Sains');
    await expect(page.getByLabel('Mata uang harga produk')).toBeVisible();
    await page.getByLabel('Mata uang harga produk').selectOption('EDU_COIN');
    await expect(page.getByLabel('Harga (Edu Coin)')).toBeVisible();
    await expect(page.getByText(/tidak perlu bukti transfer/i)).toBeVisible();
    await page.getByLabel('Mata uang harga produk').selectOption('IDR');
    await page.getByLabel('Tampilkan di Shop').check();
    await page.getByRole('button', { name: 'Simpan produk' }).click();
    await expect(page.getByText(/Produk aktif harus memiliki harga di atas Rp0/i)).toBeVisible();
  });
});

test.describe('leaderboard school podium presentation', () => {
  test('shows top XP contributors on the school podium without changing the table data', async ({ page }) => {
    await mockSupabaseLogin(page, ['student']);
    const schoolRows = [
      {
        school_key: 'sdn-1-jakarta', school_id: null, school_name: 'SDN 1 Jakarta', student_count: 5,
        levels: 'SD', average_score: 96.2, competitions_count: 110, xp: 659152, rank: 1,
        top_students: [
          { user_id: '11111111-1111-4111-8111-111111111111', username: 'aldo', display_name: 'Aldo Lestari', avatar_url: null, grade: 'SD6', xp: 140425, average_score: 98.1, competitions_count: 22 },
          { user_id: '22222222-2222-4222-8222-222222222222', username: 'eko', display_name: 'Eko Permana', avatar_url: null, grade: 'SD6', xp: 135519, average_score: 97.8, competitions_count: 21 },
          { user_id: '33333333-3333-4333-8333-333333333333', username: 'putri', display_name: 'Putri Saputra', avatar_url: null, grade: 'SD5', xp: 131580, average_score: 96.9, competitions_count: 20 },
        ],
      },
      {
        school_key: 'sdn-3-bandung', school_id: null, school_name: 'SDN 3 Bandung', student_count: 5,
        levels: 'SD', average_score: 95.4, competitions_count: 105, xp: 620459, rank: 2,
        top_students: [
          { user_id: '44444444-4444-4444-8444-444444444444', username: 'kiki', display_name: 'Kiki Wicaksono', avatar_url: null, grade: 'SD6', xp: 134086, average_score: 97.2, competitions_count: 19 },
          { user_id: '55555555-5555-4555-8555-555555555555', username: 'eko-pradipta', display_name: 'Eko Pradipta', avatar_url: null, grade: 'SD6', xp: 127851, average_score: 96.8, competitions_count: 18 },
          { user_id: '66666666-6666-4666-8666-666666666666', username: 'wawan', display_name: 'Wawan Wibowo', avatar_url: null, grade: 'SD5', xp: 123214, average_score: 96.1, competitions_count: 17 },
        ],
      },
      {
        school_key: 'sdn-5-surabaya', school_id: null, school_name: 'SDN 5 Surabaya', student_count: 5,
        levels: 'SD', average_score: 94, competitions_count: 95, xp: 580319, rank: 3,
        top_students: [
          { user_id: '77777777-7777-4777-8777-777777777777', username: 'hendra', display_name: 'Hendra Pratama', avatar_url: null, grade: 'SD6', xp: 125259, average_score: 96, competitions_count: 17 },
          { user_id: '88888888-8888-4888-8888-888888888881', username: 'aditya', display_name: 'Aditya Kusuma', avatar_url: null, grade: 'SD5', xp: 120504, average_score: 95.5, competitions_count: 16 },
          { user_id: '99999999-9999-4999-8999-999999999999', username: 'fajar', display_name: 'Fajar Firmansyah', avatar_url: null, grade: 'SD5', xp: 115792, average_score: 95, competitions_count: 15 },
        ],
      },
      {
        school_key: 'smp-8-bandung', school_id: null, school_name: 'SMP 8 Bandung', student_count: 4,
        levels: 'SMP', average_score: 93.5, competitions_count: 72, xp: 410250, rank: 4,
        top_students: [
          { user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', username: 'nabila', display_name: 'Nabila Putri', avatar_url: null, grade: 'SMP9', xp: 104250, average_score: 96.4, competitions_count: 18 },
        ],
      },
      {
        school_key: 'sma-2-jogja', school_id: null, school_name: 'SMA 2 Yogyakarta', student_count: 6,
        levels: 'SMA/SMK', average_score: 92.8, competitions_count: 88, xp: 380175, rank: 5,
        top_students: [
          { user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', username: 'rangga', display_name: 'Rangga Saputra', avatar_url: null, grade: 'SMA12', xp: 98500, average_score: 95.2, competitions_count: 17 },
        ],
      },
    ];

    const peopleRows = [
      { user_id: 'aaaaaaaa-1111-4111-8111-111111111111', username: 'juara_satu', display_name: 'Juara Pertama', institution: 'SDN 1 Jakarta', avatar_url: null, grade: 'SD6', xp: 659152, rank: 1, rank_change: 'up', point_change: 100, average_score: 96.2, competitions_count: 110, school_id: null },
      { user_id: 'bbbbbbbb-2222-4222-8222-222222222222', username: 'juara_dua', display_name: 'Juara Kedua', institution: 'SDN 3 Bandung', avatar_url: null, grade: 'SD6', xp: 620459, rank: 2, rank_change: 'same', point_change: 0, average_score: 95.4, competitions_count: 105, school_id: null },
      { user_id: 'cccccccc-3333-4333-8333-333333333333', username: 'juara_tiga', display_name: 'Juara Ketiga', institution: 'SDN 5 Surabaya', avatar_url: null, grade: 'SD6', xp: 580319, rank: 3, rank_change: 'down', point_change: 20, average_score: 94, competitions_count: 95, school_id: null },
      { user_id: 'dddddddd-4444-4444-8444-444444444444', username: 'juara_empat', display_name: 'Juara Keempat', institution: 'SMP 8 Bandung', avatar_url: null, grade: 'SMP9', xp: 410250, rank: 4, rank_change: 'same', point_change: 0, average_score: 93.5, competitions_count: 72, school_id: null },
    ];

    await page.route('**/rest/v1/rpc/get_public_leaderboard_enriched', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': '*', 'content-range': '0-3/4' },
        contentType: 'application/json',
        body: JSON.stringify(peopleRows),
      });
    });
    await page.route('**/rest/v1/rpc/get_public_school_leaderboard', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': '*', 'content-range': '0-4/5' },
        contentType: 'application/json',
        body: JSON.stringify(schoolRows),
      });
    });

    await page.goto('/login?redirect=%2Fleaderboard');
    await page.locator('input[autocomplete="email"]').fill('guru@example.test');
    await page.locator('input[autocomplete="current-password"]').fill('SafeTestPassword123!');
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/leaderboard');
    await expect(page.getByRole('heading', { name: 'Peringkat Juara' })).toBeVisible();

    // Student podium uses the same diamond rank badges while keeping profile photos.
    await expect(page.locator('.lb-person-podium')).toHaveCount(3);
    await expect(page.locator('.lb-person-rank-badge')).toHaveCount(3);
    await expect(page.locator('.lb-person-podium.rank-1 .lb-avatar-wrap')).toBeVisible();
    await expect(page.locator('.lb-main-content')).toHaveCSS('animation-name', 'none');
    await expect(page.locator('.lb-podium-area').first()).toHaveCSS('animation-name', 'lb-fade-in-up');
    await expect(page.locator('.lb-category-tab').first()).toHaveCSS('transition-duration', '0s');

    // The settings dialog is mounted above the application stacking contexts.
    await page.getByRole('button', { name: 'Pengaturan', exact: true }).click();
    const settingsDialog = page.getByRole('dialog', { name: 'Pengaturan umum' });
    await expect(settingsDialog).toBeVisible();
    await expect(settingsDialog.locator('xpath=..')).toHaveCSS('z-index', '9990');
    await settingsDialog.getByRole('button', { name: 'Tutup', exact: true }).click();

    await page.getByRole('button', { name: 'Peringkat Sekolah', exact: true }).click();

    await expect(page.locator('.lb-school-podium')).toHaveCount(3);
    const schoolLevelFilters = page.locator('.lb-school-level-filters');
    await expect(schoolLevelFilters.getByRole('button', { name: 'Semua Sekolah', exact: true })).toBeVisible();
    await expect(schoolLevelFilters.getByRole('button', { name: 'SD Sederajat', exact: true })).toBeVisible();
    await expect(schoolLevelFilters.getByRole('button', { name: 'SMP Sederajat', exact: true })).toBeVisible();
    await expect(schoolLevelFilters.getByRole('button', { name: 'SMA/SMK Sederajat', exact: true })).toBeVisible();
    await expect(page.locator('.lb-school-contributor-row')).toHaveCount(9);
    await expect(page.locator('.lb-school-podium.rank-1')).toContainText('SDN 1 Jakarta');
    await expect(page.locator('.lb-school-podium.rank-1')).toContainText('Aldo Lestari');
    await expect(page.locator('.lb-school-podium.rank-1')).toContainText('140.425 XP');
    await expect(page.locator('.lb-school-table-wrap .lb-table th[colspan="2"]')).toContainText('Peringkat & Nama');
    await expect(page.getByText('SDN 3 Bandung', { exact: true })).toBeVisible();
    await expect(page.getByText('SDN 5 Surabaya', { exact: true })).toBeVisible();
    await expect(page.locator('.lb-school-name-cell .lb-person').first()).toHaveCSS('justify-content', 'flex-start');
    await expect(page.locator('.lb-school-table-wrap')).toContainText('SMP 8 Bandung');

    await schoolLevelFilters.getByRole('button', { name: 'SMP Sederajat', exact: true }).click();
    await expect(page.locator('.lb-school-podium.rank-1')).toContainText('SMP 8 Bandung');
    await expect(page.locator('.lb-school-podium.rank-1')).not.toContainText('SDN 1 Jakarta');
    await expect(page.locator('.lb-school-table-wrap')).not.toContainText('SDN 1 Jakarta');
    await expect(page.locator('.lb-school-podium.rank-1')).toContainText('1st');

    await schoolLevelFilters.getByRole('button', { name: 'SMA/SMK Sederajat', exact: true }).click();
    await expect(page.locator('.lb-school-podium.rank-1')).toContainText('SMA 2 Yogyakarta');
    await expect(page.locator('.lb-school-podium.rank-1')).toContainText('1st');

    await schoolLevelFilters.getByRole('button', { name: 'Semua Sekolah', exact: true }).click();
    await expect(page.locator('.lb-school-podium.rank-1')).toContainText('SDN 1 Jakarta');
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
