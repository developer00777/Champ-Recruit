import { defineConfig } from '@playwright/test';

// End-to-end tests against a running local stack (`docker compose up` or `pnpm dev` + Redis/mocks).
export default defineConfig({
  testDir: './test/e2e',
  timeout: 60_000,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:8787',
    // Uses the installed Microsoft Edge so no browser download is needed; CI can switch to bundled Chromium.
    channel: process.env.PW_CHANNEL ?? 'msedge',
    screenshot: 'only-on-failure',
  },
  reporter: [['list']],
});
