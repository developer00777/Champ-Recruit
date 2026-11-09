import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

// Unit + integration tests run inside workerd with real (local) D1, R2 and Queue bindings.
// Redis points at an address that doesn't exist on purpose: the tests prove the app degrades
// to D1 when Redis is unavailable. Browser end-to-end tests live in test/e2e (Playwright).
export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            ENVIRONMENT: 'test',
            TEST_MIGRATIONS: migrations,
            UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:1',
            UPSTASH_REDIS_REST_TOKEN: 'test',
            TOKEN_ENC_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
            APP_SECRET: 'test',
            DEV_AUTH_EMAIL: 'recruiter@championsmail.com',
            MOCK_CHANNELS_URL: '',
            AI_MODE: 'mock',
          },
        },
      }),
    ],
    test: { include: ['test/unit/**/*.test.ts'], setupFiles: ['./test/unit/setup.ts'] },
  };
});
