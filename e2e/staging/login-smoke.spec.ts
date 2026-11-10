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
