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
  await expect(page.getByLabel('Password')).toHaveAttribute('id', 'login-password');
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
