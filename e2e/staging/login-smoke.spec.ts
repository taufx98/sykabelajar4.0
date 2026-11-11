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
  await expect(page.locator('input[type="password"]'), 'password input must render').toBeVisible();
  await expect(
    page.getByRole('heading', { name: /^(Masuk|Sign in)$/ }),
    'the login heading must render',
  ).toBeVisible();

  expect(failedAppAssets, 'app JavaScript/CSS assets must load successfully').toEqual([]);
  expect(pageErrors, 'the browser must not report uncaught JavaScript exceptions').toEqual([]);
});

test('an unverified Better Auth sign-in shows the email verification prompt', async ({ page }) => {
  let signInIntercepted = false;
  await page.route('https://auth.sykabelajar.my.id/api/auth/sign-in/email', async (route) => {
    signInIntercepted = true;
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'FORBIDDEN',
        message: 'EMAIL_VERIFICATION_REQUIRED',
      }),
    });
  });

  const response = await page.goto('/login', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await page.locator('input[type="email"]').fill('unverified-auth-smoke@example.test');
  await page.locator('input[type="password"]').fill('not-a-real-account-password');
  await page.getByRole('button', { name: /^Masuk$/ }).click();

  await expect(page.getByText('Email belum terverifikasi')).toBeVisible();
  await expect(page.getByText(/Layanan pengiriman email verifikasi belum aktif di staging/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kirim ulang tautan verifikasi' })).toBeDisabled();
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

test('staging registration explains that account creation is paused until verification email delivery is active', async ({ page }) => {
  const response = await page.goto('/register', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: /^(Buat Akun|Create an Account)$/ })).toBeVisible();
  await expect(page.getByText(/Pendaftaran staging sedang ditahan karena pengiriman email verifikasi belum dikonfigurasi/)).toBeVisible();
});

test('staging login recovery control opens the email form without sending a reset email', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 500)));

  const response = await page.goto('/login', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await page.getByRole('button', { name: /^(Lupa password\?|Forgot password\?)$/ }).click();
  await expect(page.getByPlaceholder(/^(Email kamu|Your email)$/)).toBeVisible();
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

  const providers = (payload as { providers: unknown[] }).providers;
  expect(providers.every((provider) => ['google', 'facebook', 'twitter'].includes(String(provider)))).toBe(true);
  console.log('STAGING_AUTH_SOCIAL_PROVIDERS=' + (providers.length ? providers.join(',') : '(none configured)'));
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
