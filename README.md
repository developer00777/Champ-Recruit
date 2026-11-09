# Champions Talent Hub

Recruiting app for Champions Group: one place to write a job (with AI help), publish it to the official careers sites, and post it to LinkedIn, Naukri, Indeed and Google for Jobs. Candidates apply once on our site, and every application records which channel it came from.

TypeScript on Cloudflare Workers, using D1, R2, Queues, Cron Triggers, Upstash Redis and the Claude API. Docker gives everyone the same local stack. The full design is in [PLAN.md](PLAN.md); the original mock-up is in [docs/demo.html](docs/demo.html).

## Run it locally

You need Docker and Node 22+ with pnpm.

```bash
cp .dev.vars.example .dev.vars       # then set TOKEN_ENC_KEY (command inside the file); ANTHROPIC_API_KEY is optional
docker compose up --build            # Worker + Redis + Upstash-compatible proxy + mock channel APIs
```

| URL | What |
|---|---|
| http://localhost:8787 | Careers portal (candidate side) |
| http://localhost:8787/console | Recruiter console (signed in locally as `DEV_AUTH_EMAIL`) |
| http://localhost:8787/examples/embed.html | Example company website using the embed widget |
| http://localhost:8787/feeds/linkedin.xml · /feeds/indeed.xml | Job feeds for LinkedIn Limited Listings and Indeed |
| http://localhost:9000/_log | What the mock LinkedIn, Indeed and Naukri APIs received |

The container migrates D1 and loads sample data (20 roles from the demo, 7 candidates) on first start. To reseed: `pnpm seed:generate && pnpm db:seed`.

Alternative without the app container (faster reloads): `docker compose up -d redis srh mocks`, then `pnpm install && pnpm db:setup && pnpm dev`.

**AI.** Without `ANTHROPIC_API_KEY`, the JD studio runs in *mock mode*: it returns templates so the flow works offline, and the console shows a "mock mode" label. With a key, it uses `claude-opus-5-5` with structured outputs, prompt caching and server-side refusal fallback. Every call is logged to `ai_runs`.

**Channels locally.** On the Channels page, use "Connect mock LinkedIn profile" and "Connect mock Indeed + Naukri". Posts go to `tools/mock-channels`. To test failures, put `[fail:401]`, `[fail:429]` or `[fail:500]` in a post's text.

## Tests

```bash
pnpm test        # 21 unit/integration tests inside workerd (real D1). Redis is deliberately unreachable to prove fallback to D1.
pnpm test:e2e    # Playwright browser flows against the running stack (uses installed Microsoft Edge)
pnpm typecheck
```

## How it fits together

- `src/index.ts`: one Worker that serves pages, the APIs, the queue consumer and the cron jobs.
- `src/routes/public`: careers pages (server-rendered, JobPosting JSON-LD, sitemap, feeds) and the candidate API (apply, email-code sign-in, alerts, community).
- `src/routes/console`: recruiter API (jobs and versions, approval, publish/close, AI, applications, channels, website webhooks). Auth is Cloudflare Access in production and `DEV_AUTH_EMAIL` locally.
- `src/channels`: one adapter per channel behind a single interface (`adapter.ts`): owned site, Google, LinkedIn member/org, LinkedIn feed, Indeed (API or feed), Naukri, custom webhook, mock.
- `src/publisher`: publish/close service, queue consumer (locks, retries with backoff, needs-reconnect handling, DLQ) and cron (scheduled posts, counter flush, token expiry reminders, auto-repost, retention).
- `src/cache`: Redis key catalogue (`keys.ts`, PLAN.md §6), cache-aside with versioned namespaces, locks, rate limits, write-behind counters and a circuit breaker so a Redis outage costs one timeout.
- `src/ai`: prompts (versioned), Zod output schemas, tasks (draft, task-specific rewrite, review, channel copy).
- `public/assets`: careers portal CSS/JS ported from the demo. `public/console`: recruiter console (plain ES modules, no build step). `public/embed.js`: website widget.

## Deploying

1. Create the resources for each environment: `wrangler d1 create talent-hub-prod`, `wrangler r2 bucket create talent-hub-files-prod`, `wrangler queues create talent-hub-publish-prod` and `…-dlq-prod`, plus an Upstash database. Put the IDs and URLs into `wrangler.jsonc` under `env.production`.
2. Set the secrets: `wrangler secret put --env production` for `UPSTASH_REDIS_REST_TOKEN`, `TOKEN_ENC_KEY`, `ANTHROPIC_API_KEY`, `APP_SECRET`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, plus optionally `RESEND_API_KEY`, `TURNSTILE_SECRET` and `GOOGLE_SA_JSON`.
3. Put Cloudflare Access in front of `/console*`, `/api/console/*` and `/oauth/*`, then set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`.
4. `pnpm deploy:production` applies the D1 migrations and deploys.
