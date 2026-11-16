import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.AUTH_STAGING_BASE_URL;
if (baseURL !== 'https://staging.sykabelajar.my.id') {
  throw new Error('AUTH_STAGING_BASE_URL must target the exact isolated staging hostname.');
}

export default defineConfig({
  testDir: './e2e/staging',
  testMatch: '**/login-smoke.spec.ts',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: true,
  retries: 1,
  reporter: 'line',
  outputDir: 'test-results/staging-browser',
  use: {
    baseURL,
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
