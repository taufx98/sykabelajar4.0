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

  const providers = (payload as { providers: unknown[] }).providers;
  expect(providers.every((provider) => ['google', 'facebook', 'twitter'].includes(String(provider)))).toBe(true);
  console.log('STAGING_AUTH_SOCIAL_PROVIDERS=' + (providers.length ? providers.join(',') : '(none configured)'));
});
