import { test, expect } from '@playwright/test';

test('staging /login mounts React and renders the email/password form', async ({ page, baseURL }) => {
  const pageErrors: string[] = [];
  const failedAppAssets: string[] = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.message.slice(0, 500));
  });

  page.on('response', (response) => {
    const url = new URL(response.url());
    const isAppAsset = url.origin === baseURL &&
      (url.pathname.endsWith('.js') || url.pathname.endsWith('.css'));
    if (isAppAsset && response.status() >= 400) {
      failedAppAssets.push(`${response.status()} ${url.pathname}`);
    }
  });

  const response = await page.goto('/login', { waitUntil: 'domcontentloaded' });
  expect(response, 'the staging login document must return a response').not.toBeNull();
  expect(response!.status(), 'the staging login document must return HTTP 200').toBe(200);

  await expect(page.locator('#root')).toBeVisible();
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page.locator('input[type="email"]'), 'email input must render').toBeVisible();
  await expect(page.locator('input[type="email"]')).toHaveAttribute('id', 'login-email');
  await expect(page.locator('input[type="email"]')).toHaveAttribute('name', 'email');
  await expect(page.getByLabel('Email')).toHaveAttribute('id', 'login-email');
  await expect(page.locator('input[type="password"]'), 'password input must render').toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveAttribute('id', 'login-password');
  await expect(page.locator('input[type="password"]')).toHaveAttribute('name', 'password');
  await expect(page.locator('label[for="login-password"]')).toHaveText('Password');
  await expect(
    page.getByRole('heading', { name: /^(Masuk|Sign in)$/ }),
    'the login heading must render',
  ).toBeVisible();

  expect(failedAppAssets, 'app JavaScript/CSS assets must load successfully').toEqual([]);
  expect(pageErrors, 'the browser must not report uncaught JavaScript exceptions').toEqual([]);
});

test('staging login respects the disabled email-verification policy', async ({ page }) => {
  let signInIntercepted = false;
  await page.route('https://auth.sykabelajar.my.id/api/auth/sign-in/email', async (route) => {
    signInIntercepted = true;
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'INVALID_EMAIL_OR_PASSWORD' }),
    });
  });

  const response = await page.goto('/login', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await page.locator('input[type="email"]').fill('staging-policy-smoke@example.test');
  await page.locator('input[type="password"]').fill('not-a-real-account-password');
  await page.getByRole('button', { name: /^Masuk$/ }).click();

  await expect(page.getByText('Email belum terverifikasi')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Kirim ulang tautan verifikasi' })).toHaveCount(0);
  expect(signInIntercepted, 'the staging login form must call the Better Auth Worker').toBe(true);
});

test('staging /register renders the first email/password step without creating an account', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 500)));

  const response = await page.goto('/register', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await expect(page.locator('#root')).toBeVisible();
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page.getByRole('heading', { name: /^(Buat Akun|Create an Account)$/ })).toBeVisible();
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(2);
  await expect(page.getByRole('button', { name: /^(Lanjut|Continue)$/ })).toBeDisabled();
  expect(pageErrors, 'registration must not throw before the user submits the form').toEqual([]);
});

test('staging registration wizard exposes labelled fields and keyboard-friendly role/category choices', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 500)));

  const response = await page.goto('/register', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);

  const email = page.locator('#register-email');
  const password = page.locator('#register-password');
  const passwordConfirm = page.locator('#register-password-confirm');
  await expect(page.getByLabel(/^(Email)$/)).toHaveAttribute('id', 'register-email');
  await expect(page.getByLabel(/^(Password)$/)).toHaveAttribute('id', 'register-password');
  await expect(page.getByLabel(/^(Konfirmasi Password|Confirm password)$/)).toHaveAttribute('id', 'register-password-confirm');
  await expect(email).toHaveAttribute('name', 'email');
  await expect(email).toHaveAttribute('autocomplete', 'email');
  await expect(password).toHaveAttribute('name', 'password');
  await expect(password).toHaveAttribute('autocomplete', 'new-password');
  await expect(passwordConfirm).toHaveAttribute('name', 'confirmPassword');

  await email.fill('auth-ui-smoke@example.test');
  await password.fill('Testing123!');
  await passwordConfirm.fill('Testing123!');
  await page.getByRole('button', { name: /^(Lanjut|Continue)$/ }).click();

  await expect(page.getByLabel(/^(Nama Lengkap|Full name)$/)).toHaveAttribute('id', 'register-full-name');
  await expect(page.getByLabel(/^Username$/)).toHaveAttribute('id', 'register-username');
  await expect(page.getByLabel(/^(Tanggal Lahir|Date of birth)$/)).toHaveAttribute('id', 'register-birth-date');
  await expect(page.getByLabel(/^(Sekolah \/ Institusi|School \/ Institution)$/)).toHaveAttribute('id', 'register-school');

  const roleGroup = page.getByRole('group', { name: /^(Jenis akun|Account type)$/ });
  await expect(roleGroup).toBeVisible();
  await expect(roleGroup.locator('button[aria-pressed="true"]')).toHaveCount(1);
  await expect(roleGroup.getByRole('button', { name: 'Pelajar' })).toBeVisible();

  const education = page.locator('#register-education-level');
  await expect(education).toHaveAttribute('name', 'educationLevel');
  const firstEducationOption = await education.locator('option').nth(1).getAttribute('value');
  expect(firstEducationOption).toBeTruthy();
  await education.selectOption(firstEducationOption!);

  await page.locator('#register-full-name').fill('Auth UI Test');
  await page.locator('#register-username').fill('auth-ui-smoke');
  await page.locator('#register-birth-date').fill('2000-01-01');
  await page.locator('#register-school').fill('Staging UI Test School');
  await page.getByRole('button', { name: /^(Lanjut|Continue)$/ }).click();

  const categoryGroup = page.getByRole('group', { name: /^(Kategori lomba favorit|Favorite competition categories)$/ });
  await expect(categoryGroup).toBeVisible();
  await expect(categoryGroup.locator('button').first()).toBeVisible();
  expect(pageErrors, 'the registration wizard must not throw while changing steps').toEqual([]);
});

test('staging registration is not blocked by missing email delivery while bypass is active', async ({ page }) => {
  const response = await page.goto('/register', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: /^(Buat Akun|Create an Account)$/ })).toBeVisible();
  await expect(page.getByText(/Pendaftaran staging sedang ditahan karena pengiriman email verifikasi belum dikonfigurasi/)).toHaveCount(0);
});

test('staging login recovery control opens the email form without sending a reset email', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 500)));

  const response = await page.goto('/login', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await page.getByRole('button', { name: /^(Lupa password\?|Forgot password\?)$/ }).click();
  await expect(page.locator('#forgot-password-email')).toBeVisible();
  await expect(page.locator('#forgot-password-email')).toHaveAttribute('name', 'forgotEmail');
  await expect(page.getByLabel('Email').nth(1)).toHaveAttribute('id', 'forgot-password-email');
  await expect(page.getByRole('button', { name: /^(Kirim Link Reset|Send reset link)$/ })).toBeVisible();
  expect(pageErrors, 'password recovery form must not throw before submit').toEqual([]);
});

test('the staging Worker exposes its safe OAuth provider discovery contract', async ({ request, baseURL }) => {
  const response = await request.get('https://auth.sykabelajar.my.id/api/auth/providers', {
    headers: { Origin: baseURL! },
  });
  expect(response.status(), 'the staging OAuth provider discovery endpoint must be reachable').toBe(200);

  const payload: unknown = await response.json();
  expect(payload).toMatchObject({
    ok: true,
    issuer: 'https://auth.sykabelajar.my.id/api/auth',
  });
  expect(payload).toHaveProperty('providers');
  expect(Array.isArray((payload as { providers?: unknown }).providers)).toBe(true);
  expect(typeof (payload as { emailVerificationConfigured?: unknown }).emailVerificationConfigured)
    .toBe('boolean');
  expect(typeof (payload as { emailVerificationRequired?: unknown }).emailVerificationRequired)
    .toBe('boolean');
  expect((payload as { emailVerificationRequired: boolean }).emailVerificationRequired)
    .toBe(false);

  const providers = (payload as { providers: unknown[] }).providers;
  expect(providers.every((provider) => ['google', 'facebook', 'twitter'].includes(String(provider)))).toBe(true);
  console.log('STAGING_AUTH_SOCIAL_PROVIDERS=' + (providers.length ? providers.join(',') : '(none configured)'));
});

test('staging browser can complete Supabase REST CORS preflight for external Bearer tokens', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });

  // This deliberately invalid JWT can never read account data. A zero-row
  // query verifies only that the browser can pass CORS preflight for the same
  // apikey + Authorization headers used by the external Better Auth token.
  const result = await page.evaluate(async () => {
    const response = await fetch(
      'https://ydamszdfsxqisanazdkb.supabase.co/rest/v1/user_roles?select=role&limit=0',
      {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        headers: {
          apikey: 'sb_publishable_4GjRAXld9GnxYf2pJBPrTQ_Pqh_QI4v',
          Authorization: 'Bearer invalid-cors-preflight-probe',
          Accept: 'application/json',
        },
      },
    );
    return { status: response.status, type: response.type };
  });

  expect(result.type, 'the cross-origin Supabase response must be CORS-readable').toBe('cors');
  expect(result.status, 'a response after CORS preflight must reach Supabase REST').toBeGreaterThan(0);
});

test('configured Google OAuth starts with state and a secure same-site state cookie', async ({ page, baseURL, context }) => {
  const discovery = await page.request.get('https://auth.sykabelajar.my.id/api/auth/providers', {
    headers: { Origin: baseURL! },
  });
  expect(discovery.status()).toBe(200);
  const providerPayload = await discovery.json() as { providers?: unknown };
  const providers = Array.isArray(providerPayload.providers) ? providerPayload.providers : [];
  test.skip(!providers.includes('google'), 'Google OAuth Worker secrets are not configured yet.');

  await page.goto('/login', { waitUntil: 'domcontentloaded' });

  const flow = await page.evaluate(async () => {
    const response = await fetch('https://auth.sykabelajar.my.id/api/auth/sign-in/social', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'google',
        callbackURL: 'https://staging.sykabelajar.my.id/home',
      }),
    });
    const payload = await response.json().catch(() => null) as { url?: unknown } | null;
    if (!response.ok || !payload || typeof payload.url !== 'string') {
      return { status: response.status, authorizationUrlValid: false, statePresent: false, redirectUri: null, authorizationHost: null };
    }
    const authorizationUrl = new URL(payload.url);
    return {
      status: response.status,
      authorizationUrlValid: authorizationUrl.protocol === 'https:',
      statePresent: Boolean(authorizationUrl.searchParams.get('state')),
      redirectUri: authorizationUrl.searchParams.get('redirect_uri'),
      authorizationHost: authorizationUrl.hostname,
    };
  });

  expect(flow.status, 'Better Auth should accept the configured Google provider').toBe(200);
  expect(flow.authorizationUrlValid).toBe(true);
  expect(flow.authorizationHost).toBe('accounts.google.com');
  expect(flow.statePresent, 'Google authorization URL must include the state parameter').toBe(true);
  expect(flow.redirectUri).toBe('https://auth.sykabelajar.my.id/api/auth/callback/google');

  const cookies = await context.cookies('https://auth.sykabelajar.my.id');
  const stateCookies = cookies.filter((cookie) => cookie.name.toLowerCase().includes('state'));
  expect(stateCookies.length, 'the browser must retain a Better Auth OAuth state cookie on the auth host').toBeGreaterThan(0);
  for (const cookie of stateCookies) {
    expect(cookie.secure, 'OAuth state cookie must be Secure').toBe(true);
    expect(cookie.sameSite, 'OAuth state cookie must use SameSite=Lax').toBe('Lax');
  }
});

test('a stalled staging sign-in request exits the loading state after the bounded timeout', async ({ page }) => {
  let signInRequests = 0;
  await page.route('https://auth.sykabelajar.my.id/api/auth/sign-in/email', async (route) => {
    signInRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 15_000));
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { id: '00000000-0000-4000-8000-000000000001', email: 'timeout@example.test' } }),
      });
    } catch {
      // The browser should abort the stalled fetch when the auth timeout fires.
    }
  });

  const response = await page.goto('/login', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await page.locator('#login-email').fill('timeout@example.test');
  await page.locator('#login-password').fill('not-a-real-password');
  const signInButton = page.getByRole('button', { name: /^Masuk$/ });
  await signInButton.click();

  await expect(signInButton, 'the login button must leave its loading state after the Worker timeout')
    .toBeEnabled({ timeout: 16_000 });
  await expect(page.getByText('AUTH_REQUEST_TIMEOUT')).toBeVisible();
  expect(signInRequests, 'credential POST must not be automatically replayed').toBe(1);
});

test('a rejected staging sign-in does not hard-reload the login route', async ({ page }) => {
  let signInRequests = 0;
  let postInitialDocumentNavigations = 0;
  await page.route('https://auth.sykabelajar.my.id/api/auth/sign-in/email', async (route) => {
    signInRequests += 1;
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'INVALID_EMAIL_OR_PASSWORD' }),
    });
  });

  await page.goto('/login?redirect=%2Fhome', { waitUntil: 'domcontentloaded' });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) postInitialDocumentNavigations += 1;
  });
  await page.locator('#login-email').fill('invalid-login@example.test');
  await page.locator('#login-password').fill('not-a-real-password');
  const signInButton = page.getByRole('button', { name: /^Masuk$/ });
  await signInButton.click();

  await expect(signInButton).toBeEnabled();
  await expect(page).toHaveURL(/\/login\?redirect=%2Fhome$/);
  await expect(page.getByText('INVALID_EMAIL_OR_PASSWORD')).toBeVisible();
  expect(signInRequests).toBe(1);
  expect(postInitialDocumentNavigations, 'a rejected sign-in must not reload the document').toBe(0);
});


test('synthetic D1 quota 503 shows its retry time without redirecting to login', async ({ page }) => {
  const retryAtUtc = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  let sessionReads = 0;
  let signOutRequests = 0;

  await page.route('https://auth.sykabelajar.my.id/api/auth/get-session', async (route) => {
    sessionReads += 1;
    await route.fulfill({
      status: 503,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': '3600',
        'x-auth-availability': 'degraded',
        'access-control-expose-headers': 'X-Auth-Availability, Retry-After',
      },
      body: JSON.stringify({
        error: 'AUTH_TEMPORARILY_UNAVAILABLE',
        code: 'D1_FREE_TIER_ROWS_READ_LIMIT_REACHED',
        message: 'Authentication service is temporarily unavailable.',
        retry_at_utc: retryAtUtc,
      }),
    });
  });
  await page.route('https://auth.sykabelajar.my.id/api/auth/sign-out', async (route) => {
    signOutRequests += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  const response = await page.goto('/home', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Koneksi autentikasi terganggu' })).toBeVisible();
  await expect(page.getByText(/Batas penggunaan harian layanan login telah tercapai\. Sesi tidak dihapus\./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Coba lagi' })).toBeVisible();
  await expect(page).toHaveURL(/\/home$/);
  expect(sessionReads).toBeGreaterThan(0);
  expect(signOutRequests, 'a D1 availability error must not trigger sign-out').toBe(0);
});

test('synthetic Cloudflare Error 1027 page shows recoverable auth availability UI', async ({ page }) => {
  let sessionReads = 0;
  let signOutRequests = 0;

  // This is a controlled edge-response simulation. It does not exhaust the
  // account's 100,000-request Free limit or change the real Cloudflare route.
  await page.route('https://auth.sykabelajar.my.id/api/auth/get-session', async (route) => {
    sessionReads += 1;
    await route.fulfill({
      status: 503,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><body><h1>Cloudflare Error 1027</h1></body></html>',
    });
  });
  await page.route('https://auth.sykabelajar.my.id/api/auth/sign-out', async (route) => {
    signOutRequests += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  const response = await page.goto('/home', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Koneksi autentikasi terganggu' })).toBeVisible();
  await expect(page.getByText('Sesi belum dinyatakan berakhir. Periksa koneksi lalu coba muat sesi kembali.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Coba lagi' })).toBeVisible();
  await expect(page).toHaveURL(/\/home$/);
  expect(sessionReads).toBeGreaterThan(0);
  expect(signOutRequests, 'an edge quota page must not trigger sign-out').toBe(0);
});


const publicRegistrationRoles = [
  { accountType: 'student', uiLabel: 'Pelajar', email: 'auth-student-ui@example.test' },
  { accountType: 'teacher', uiLabel: 'Guru', email: 'auth-teacher-ui@example.test' },
  { accountType: 'organizer', uiLabel: 'Penyelenggara', email: 'auth-organizer-ui@example.test' },
] as const;

for (const roleCase of publicRegistrationRoles) {
  test(`registration submits a fresh Better Auth ${roleCase.accountType} account payload`, async ({ page }) => {
    const signupRequests: Record<string, unknown>[] = [];
    const fakeUserId = roleCase.accountType === 'student'
      ? '00000000-0000-4000-8000-000000000101'
      : roleCase.accountType === 'teacher'
        ? '00000000-0000-4000-8000-000000000102'
        : '00000000-0000-4000-8000-000000000103';

    // Stub the Better Auth transport so the browser contract is tested without
    // creating persistent D1/Supabase identities or sending real email.
    await page.route('https://auth.sykabelajar.my.id/api/auth/providers', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          issuer: 'https://auth.sykabelajar.my.id/api/auth',
          providers: [],
          emailVerificationConfigured: false,
          emailVerificationRequired: false,
        }),
      });
    });
    await page.route('https://auth.sykabelajar.my.id/api/auth/sign-up/email', async (route) => {
      signupRequests.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          token: null,
          user: {
            id: fakeUserId,
            email: roleCase.email,
            emailVerified: false,
            name: 'Auth Registration UI Test',
          },
        }),
      });
    });
    await page.route('https://auth.sykabelajar.my.id/api/auth/get-session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: 'null',
      });
    });

    const response = await page.goto('/register', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);

    await page.locator('#register-email').fill(roleCase.email);
    await page.locator('#register-password').fill('Testing123!');
    await page.locator('#register-password-confirm').fill('Testing123!');
    await page.getByRole('button', { name: /^(Lanjut|Continue)$/ }).click();

    await page.getByRole('group', { name: /^(Jenis akun|Account type)$/ })
      .getByRole('button', { name: roleCase.uiLabel }).click();
    await page.locator('#register-full-name').fill('Auth Registration UI Test');
    await page.locator('#register-username').fill(`auth-${roleCase.accountType}-ui`);
    await page.locator('#register-birth-date').fill('2000-01-01');
    await page.locator('#register-school').fill('Staging UI Contract Test');
    if (roleCase.accountType === 'student') {
      await page.locator('#register-education-level').selectOption('sma');
    }
    await page.getByRole('button', { name: /^(Lanjut|Continue)$/ }).click();

    const categories = page.getByRole('group', { name: /^(Kategori lomba favorit|Favorite competition categories)$/ });
    await categories.getByRole('button').first().click();
    await page.getByRole('button', { name: /^(Buat Akun|Create Account)$/ }).click();

    await expect(page).toHaveURL(/\\/login(?:$|\\?)/);
    expect(signupRequests).toHaveLength(1);
    expect(signupRequests[0]).toMatchObject({
      email: roleCase.email,
      password: 'Testing123!',
      name: 'Auth Registration UI Test',
      username: `auth-${roleCase.accountType}-ui`,
      accountType: roleCase.accountType,
      birthDate: '2000-01-01',
      institution: 'Staging UI Contract Test',
    });
    expect(typeof signupRequests[0].subjects).toBe('string');
    expect(String(signupRequests[0].subjects).length).toBeGreaterThan(0);
    expect(signupRequests[0]).not.toHaveProperty('role');
    expect(signupRequests[0].accountType).not.toBe('admin');
  });
}
