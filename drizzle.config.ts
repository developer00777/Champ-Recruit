import { defineConfig } from 'drizzle-kit';

// Only used to generate SQL migrations; wrangler applies them to D1.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './migrations',
});
