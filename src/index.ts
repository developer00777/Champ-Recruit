import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv, Env } from './env';
import type { PublishMessage } from './publisher/types';
import { publicApi } from './routes/public/api';
import { pages } from './routes/public/pages';
import { redisHealthy } from './cache/cache';
import { consoleApi } from './routes/console/api';
import { linkedinOAuth } from './routes/oauth/linkedin';

const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
  c.set('requestId', c.req.header('cf-ray') ?? crypto.randomUUID());
  await next();
  c.header('x-request-id', c.get('requestId'));
  c.header('x-content-type-options', 'nosniff');
  c.header('referrer-policy', 'strict-origin-when-cross-origin');
});

app.get('/health', async (c) => {
  const [d1, redisOk] = await Promise.all([
    c.env.DB.prepare('select 1 as ok').first<{ ok: number }>().then((r) => r?.ok === 1).catch(() => false),
    redisHealthy(c.env),
  ]);
  const debug = c.env.ENVIRONMENT === 'dev' ? { redisUrl: c.env.UPSTASH_REDIS_REST_URL } : {};
  return c.json({ ok: d1, d1, redis: redisOk, env: c.env.ENVIRONMENT, ...debug }, d1 ? 200 : 503);
});

app.route('/api/public/v1', publicApi);
app.route('/api/console', consoleApi);
app.route('/oauth/linkedin', linkedinOAuth);
// Recruiter console (static SPA in public/console). Same auth as its API.
app.get('/console', (c) => c.env.ASSETS.fetch(new Request(new URL('/console/index.html', c.req.url))));
app.route('/', pages);

app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'Not found' }, 404) : c.env.ASSETS.fetch(c.req.raw)));

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.req.path.startsWith('/api/') || c.req.path.startsWith('/oauth/')
      ? c.json({ error: err.message }, err.status)
      : c.text(err.message, err.status);
  }
  console.error(`[${c.get('requestId')}]`, err);
  return c.json({ error: 'Something went wrong. Please try again.', requestId: c.get('requestId') }, 500);
});

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<PublishMessage>, env: Env, ctx: ExecutionContext) {
    const { handleQueue } = await import('./publisher/consumer');
    await handleQueue(batch, env, ctx);
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const { handleCron } = await import('./publisher/scheduler');
    await handleCron(controller.cron, env, ctx);
  },
} satisfies ExportedHandler<Env, PublishMessage>;

export { app };
