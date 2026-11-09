# Champions Talent Hub — build plan

Draft for review · 9 Nov 2026 · based on the demo `Champions Talent Hub (Copy).html`

---

## 1. What we are building

A standalone recruiting app, written in TypeScript and running on Cloudflare, that turns the demo into a working system:

1. **One place to create a job.** A recruiter writes a job (with AI help), gets it approved, and publishes it.
2. **Official careers sites stay in sync.** The group careers site and each company's careers page (LakeB2B, Ampliz, Champion InfoMetrics, Champions Yacht Club, …) read jobs from this app. A job is live on every site as soon as it is published, and gone as soon as it is closed.
3. **One click posts to every connected channel.** Recruiters connect their channel accounts once. Publishing then posts the job to LinkedIn (their profile, the company page and LinkedIn Jobs), Naukri, Indeed and Google for Jobs, with copy written for each channel.
4. **AI writes and sharpens the JD.** Claude drafts the JD from a short brief, rewrites vague lines into concrete tasks, flags missing facts, writes the channel copy, and later gives advisory CV-fit notes.
5. **Candidates apply once, on our site.** Every channel links back to the official job page. Each application records which channel it came from, so the recruiter dashboard shows which channels actually produce hires.

> I read "career portals of our website" as the careers pages of the group and company websites. Job boards such as Naukri and Indeed are treated as **channels** in this plan.

**What carries over from the demo**

| Demo piece | Becomes |
|---|---|
| Find roles, job page, apply-to-many, My applications, alerts, talent community | The public careers portal (server-rendered, so search engines can read it) |
| Job page sections (The opportunity, Responsibilities, Must have, Nice to have, What we look for, First 90 days, What we offer, Skills) | The fixed JD schema the AI fills in and the database stores |
| Recruiter console: KPIs, funnel, sources, requisition tracker, candidate table, bench campaign, pipeline maths | The recruiter console dashboard and pipeline |
| Search logic (`SYN` short forms, `parseQ`, relevance ranking) and the CV skill dictionary (`SKILLS`) | Ported as-is into the server search and the basic CV matcher |
| Stages (Applied → Screening → Assessment → Interview → Offer → Hired / Not selected / Withdrawn) | The application stage enum |
| Two consents, fraud banner, `CG-` requisition IDs, "a recruiter makes every decision" | Kept as product rules, enforced in the API |
| Design tokens (light orange and white, Archivo, Instrument Sans) | The default brand theme. Each company can override its accent colour and logo. |

---

## 2. Architecture

```
   Recruiters (company SSO via Cloudflare Access)        Candidates · Google · LinkedIn link previews
                    │                                                     │
                    ▼                                                     ▼
┌──────────────────────── Cloudflare Worker "talent-hub" (Hono, TypeScript) ────────────────────────┐
│  /console        React SPA (Workers static assets)    │  /  /jobs/:req/:slug   server-rendered pages  │
│  /api/console/*  jobs · AI · channels · pipeline      │  /api/public/v1/*      jobs, apply, alerts    │
│  /oauth/*        LinkedIn / Indeed connect + callback │  /feeds/*.xml  /sitemap-jobs.xml  /embed.js   │
│                                                                                                    │
│  fetch()  ·  queue()  publisher, emails, webhooks, AI batch  ·  scheduled()  reposts, expiry, flush  │
└──────┬───────────────┬──────────────────┬───────────────────┬──────────────────┬──────────────────┘
       │               │                  │                   │                  │
   D1 (SQL)        R2 (files)       Redis (Upstash)      Queues + DLQ      Claude API  ·  Workers AI
   source of       CVs, pitches,    cache, locks,        one message per    JD, copy,     toMarkdown
   truth           job-card images  rate limits,         job × channel      CV notes      (CV → text)
                                    counters
       │
       └─► Channel adapters ─► LinkedIn (profile post, page post, Limited Listings feed) · Indeed Job Sync
                               · Naukri webhooks · Google Indexing API · company websites (API / widget / webhooks)
```

### Stack

| Concern | Choice | Why |
|---|---|---|
| Runtime | Cloudflare Workers, a single Worker with `fetch`, `queue` and `scheduled` handlers | One deployable. No servers to run. Fast everywhere. |
| HTTP and server-side rendering | Hono (routing, middleware, JSX for public pages) | Small, built for Workers. Public job pages must be server-rendered for Google for Jobs and LinkedIn link previews. |
| Recruiter console | React + Vite + TanStack Query, served as Workers static assets | The console is interactive: the JD studio, the pipeline board and channel previews. |
| Validation and types | Zod, shared between API, console and AI schemas | One schema per entity, reused everywhere |
| Database | D1 + Drizzle ORM. Migrations via `wrangler d1 migrations`. Location hint `apac`. | Requested. SQLite is enough for recruiting volumes, with a 10 GB cap per database. |
| Files | R2, private bucket. Uploads go straight to R2 via presigned URLs. Downloads use short-lived signed links. | CVs, pitch audio/video, generated job-card images, exports |
| Cache | Redis (Upstash) behind the Cloudflare edge cache (§6) | Requested. Gives atomic counters, locks and rate limits, which KV cannot. |
| Async work | Cloudflare Queues with a dead-letter queue. Cron Triggers every minute, hourly and nightly. | Retries and backoff for channel posting. Scheduled posts. |
| AI | Claude API via `@anthropic-ai/sdk`. Workers AI `toMarkdown()` turns CV PDF/DOCX into text. | See §4 |
| Recruiter auth | Cloudflare Access (Google Workspace or Microsoft 365 SSO). Roles live in D1. | No login code to write. Free for up to 50 seats. |
| Candidate auth | Passwordless email code. Optional "Sign in with LinkedIn" (OpenID Connect) to prefill name and email. | Matches the demo's apply-once profile |
| Bot protection | Turnstile on the apply, alert and community forms, plus Redis rate limits | |
| Email | Transactional provider over HTTP (Resend or SES), behind an interface | Status updates, alerts, OTP codes, campaign mail |
| Tests | Vitest with `@cloudflare/vitest-pool-workers` (real D1/R2/Queue bindings), Playwright for end-to-end | |

### What "dockerised" means here (decision needed, see §12)

Cloudflare Workers do not run Docker images. They run in Cloudflare's V8 isolate runtime, and that runtime is the only place D1 bindings exist. So the recommendation is:

- **Docker for development, CI and deployment tooling.** `docker compose up` gives every developer the same stack: the Worker in `wrangler dev` with local D1/R2/Queues, a real Redis, a mail catcher and mock channel APIs. CI builds the same image, runs the tests, applies D1 migrations and runs `wrangler deploy`.
- **Production runs as a Worker.** It is cheaper, faster and has native D1/R2 bindings.
- **Cloudflare Containers** (GA since April 2026) stays available for any future piece that truly needs a container, such as heavy document conversion. A container reaches D1 and R2 only through a Worker, so the core app stays a Worker.

### What "Redis on Cloudflare" means here

Cloudflare has no managed Redis, and a Worker cannot use a normal Redis TCP client reliably. **Upstash Redis** is the standard choice: it is a hosted Redis with an HTTP API (`@upstash/redis/cloudflare`). Pick a primary region near Bengaluru (Mumbai). Locally, the same client talks to a real `redis:7` container through `serverless-redis-http` (SRH), which speaks Upstash's HTTP protocol, so the code is identical in dev and prod.

---

## 3. Channels: what is actually possible

Checked against current platform docs (links at the end). The headline: **LinkedIn does not let new apps post into LinkedIn Jobs through its API.** Its Job Posting API is closed to new partners. This plan therefore uses three separate LinkedIn routes.

| Channel | How the app posts | Access needed | Cost and limits | Phase |
|---|---|---|---|---|
| **Official careers sites** (group + each company) | Our server-rendered pages, public JSON API, embeddable widget and signed webhooks (§7) | None | — | 1 |
| **Google for Jobs** | `JobPosting` JSON-LD on every job page, a jobs sitemap, and an Indexing API ping on publish and close | Search Console + a service account | Free | 1 |
| **LinkedIn: recruiter's own profile** | Posts API as the member (`w_member_social`, the self-serve "Share on LinkedIn" product). Copy + job-card image + link. | Self-serve developer app | Free. The token lasts about 60 days with no refresh, so the app tracks expiry and prompts the recruiter to reconnect. | 1 |
| **LinkedIn: company page** | Posts API as the organisation (`w_organization_social`, from the Community Management API) | App review: Development tier first, then Standard tier. Needs a verified page and domain, a privacy policy and a screen recording. The connecting person must be a Page admin or content admin. Plan on a separate developer app for this product; LinkedIn has required that, so confirm in the portal. | Takes weeks. **If Standard tier is rejected, the same app cannot reapply**, so prepare carefully. | 2 |
| **LinkedIn Jobs tab** | "Limited Listings" XML feed served at `/feeds/linkedin.xml` | Turn on "Enable basic job posting" on each company page. Every job needs a poster email. Register the feed with LinkedIn. | Free, but LinkedIn caps the count. Listings rank below paid jobs and are not pushed in alerts. LinkedIn picks up changes every ~6–12 h. | 2 |
| **Indeed** | Job Sync API (GraphQL): create, upsert, expire, status | Developer agreement and approval. The API opened to direct employers in Jul 2026. | Free API. Indeed has a single-source feed policy, so this app must be the only source sending our jobs to Indeed. | 2 |
| **Naukri** | Naukri's integration webhooks (create, update, delete) using endpoints and keys issued by Naukri's integration team | Paid Naukri subscription + their integration module | Commercial; ask Naukri for a quote | 2 |
| **Later** | Facebook/Instagram page, X, WhatsApp Channel, Slack/Teams referral posts, foundit/Instahyre | Per platform | | 3 |

**Recommended "2–3 more channels":** Naukri (volume hiring for Lead Gen, BD and Customer Service in India), Indeed, and Google for Jobs (free, and only needs our own pages to be right).

**What we will not do:** use browser automation or scraping to post as a user on LinkedIn or Naukri. It breaks their terms and gets recruiter accounts restricted. Every channel goes through an official API or feed.

### 3.1 Adapter contract

Each channel is one file implementing the same interface. Adding a channel later means writing one adapter.

```ts
type Provider = 'owned_site' | 'google_jobs' | 'linkedin_member' | 'linkedin_org'
              | 'linkedin_feed' | 'indeed' | 'naukri' | 'webhook';

interface ChannelAdapter {
  provider: Provider;
  mode: 'api' | 'feed' | 'social';           // feed = they pull from us; social = a post, not a listing
  capabilities: { update: boolean; close: boolean; media: boolean; stats: boolean };
  auth: OAuth2Config | ApiKeyConfig | null;
  validate(job: Job, copy: PostCopy): Issue[];              // char limits, required fields, before queueing
  publish(ctx: AdapterCtx, job: Job, copy: PostCopy): Promise<{ externalId: string; url?: string }>;
  update?(ctx: AdapterCtx, posting: Posting, job: Job): Promise<void>;
  close?(ctx: AdapterCtx, posting: Posting): Promise<void>;
  stats?(ctx: AdapterCtx, posting: Posting): Promise<ChannelStats>;
}
// Errors are classified: Retryable (429/5xx/network) · NeedsReauth (401/expired) · Permanent (validation)
```

A `mock` adapter (backed by the mock server in Docker) behaves like each real API, so the whole flow can be built and tested before any approvals arrive.

### 3.2 Publish pipeline

1. **Create.** The recruiter enters a brief. AI drafts the JD (§4). The recruiter edits and submits.
2. **Approve.** An HR or hiring-manager approval is optional and set per company. The job becomes `open`.
3. **Plan distribution.** The job's distribution profile picks the channels; for example, Lead Gen roles go to the site, LinkedIn page, Naukri and Indeed, while Leadership roles go to the site and LinkedIn page only. AI writes copy for each channel. **Social posts are previewed by default:** the recruiter sees the LinkedIn post exactly as it will look, edits it and confirms. The recruiter can also schedule a time.
4. **Publish** (`POST /api/console/jobs/:id/publish`, with an `Idempotency-Key` header):
   - One D1 batch writes `postings` rows with status `queued`. Each row has a unique idempotency key = hash(job, connection, content version, run number).
   - Bump the Redis cache versions, purge the job's URLs from the edge cache, send signed webhooks to company websites, and ping the Google Indexing API.
   - Send one Queue message per external posting.
5. **Queue consumer**, for each message:
   - Take the Redis lock `lock:post:{job}:{conn}`.
   - Load the connection and decrypt its token.
   - Check token expiry. If it has expired, set status `needs_reauth` and notify the recruiter.
   - Call `adapter.publish`.
   - Store the external ID and URL, and set status `live`.
   - On error: retryable errors retry with exponential backoff. Permanent errors set status `failed` with a readable reason. After the retry limit, the message goes to the DLQ and the recruiter is notified.
6. **Edit.** Adapters that support updates (Indeed, Naukri, feeds, our site) re-sync automatically. Social posts cannot be edited after posting; they are marked "out of date" and the console offers a re-share.
7. **Close or filled.** Indeed expires, Naukri gets a delete call, the feeds drop the job, and Google gets `validThrough` plus an Indexing ping. Our job page stays up but shows "This role is closed" with similar roles. Deleting the LinkedIn post is optional.
8. **Auto-repost.** A cron job finds open jobs with unfilled seats and a `repost_every_days` setting. It creates a new copy variant (so the post is not a duplicate) and queues a new posting run, previewed or automatic depending on the profile.

**Status the recruiter sees per channel:** scheduled → queued → posting → **live** (with a link) / failed (with the reason and a Retry button) / needs reconnect / closed.

### 3.3 Source attribution

Every outbound link is `https://careers…/jobs/CG-2026-1103/lead-generation-executive?src=linkedin_org&p=<postingId>`. The apply form keeps `src` and `p`, which feed the existing "Where applicants come from" chart and a new **channel → applications → interviews → hires** report. That report is the basis for the channel recommendations in Phase 3.

### 3.4 Channels page in the console

- A card per connection: connected account, who connected it, token expiry countdown, last success.
- Connect and Reconnect buttons start an OAuth flow with PKCE. Tokens are encrypted with AES-GCM before they are stored and are never sent to the browser.
- Expiry reminders go out at 7, 3 and 1 days.
- Distribution profiles: default channels per company and department, auto-publish on/off, preview required on/off, repost interval.

---

## 4. AI assistance (Claude)

| Feature | Recruiter gives | AI returns | Phase |
|---|---|---|---|
| **Draft JD from a brief** | e.g. "Need 15 LGEs, US shift, Bengaluru, freshers OK, LakeB2B" | A full JD in the house format (the demo's job page sections), plus department, experience band, shift, work mode, skills tags, and **open questions** for facts it must not invent (pay, benefits, interview rounds) | 1 |
| **Make it task-specific** | An existing JD or line | Vague lines rewritten as concrete tasks with volume, tools and outcomes. For example, "Handle outreach" becomes "Run 3-step email and LinkedIn sequences to 60 new contacts a day; book 8 qualified meetings a month". Also measurable First-90-days outcomes and a role-specific assessment task (mock cold call, data sheet, case). | 1 |
| **JD review** | A JD | A score for clarity, specificity, completeness, inclusive language and length, plus line-by-line suggestions the recruiter accepts or rejects one at a time. It also flags missing salary, shift or location, and checks the fraud note and requisition ID are present. | 1 |
| **Channel copy** | An approved JD + channel | A LinkedIn profile post (personal voice), a LinkedIn page post (company voice), Naukri and Indeed descriptions, and a short WhatsApp/Slack version. Each fits the channel's limits, includes hashtags and the tracked link, and comes in 2 variants. | 1–2 |
| **Screening questions** | A JD | 5–8 knockout and screening questions mapped to the must-haves | 2 |
| **CV parsing** | A CV file | A structured profile that prefills the apply form | 3 |
| **CV-fit notes** (advisory) | A JD + CV with personal details removed | Must-have by must-have evidence, gaps, and an overall fit band. **Never auto-rejects.** A recruiter makes every decision, as the demo promises candidates. | 3 |
| **Channel recommendation** | A JD | Which channels to use. Starts from rules (role family × seniority), then switches to our own source → hire data once there are ~3 months of it. | 3 |

**How it is built**

- **Model:** `claude-opus-5-5` for every task. Effort is tuned per task: `low` for copy and tags, `medium` for drafting, reviewing and fit notes. A cheaper model for bulk CV scoring is a cost choice to make later, after measuring quality on our data.
- **Structured outputs:** `client.messages.parse({ …, output_config: { format: zodOutputFormat(JobDescriptionSchema) } })`. The response lands directly in DB fields with no text parsing. Long outputs that are shown as they are written (post copy) are streamed to the console over SSE.
- **Grounding over guessing:** each company has an approved **company profile** stored in D1 (what we offer, locations, shifts, incentive policy, culture lines). The prompt states that pay, benefits and claims come only from that profile. Anything missing goes into `openQuestions` and is never invented.
- **Prompt caching:** the stable part (house rules, JD format, company profile, 2 approved example JDs from the same role family) goes first with `cache_control`. The changing part (the brief) goes last. Repeat drafts for the same company then cost much less.
- **Refusal fallback:** server-side `fallbacks: "default"` (beta header `server-side-fallback-2026-07-01`). If the model declines a request, it retries automatically instead of failing the recruiter's action.
- **Every call is logged** to `ai_runs` (task, prompt version, tokens, cache hits, latency, user). Each recruiter has a daily AI budget, enforced in Redis. Identical requests are served from the Redis AI cache.
- **Prompt changes are tested.** Prompts live in the repo with a version number. Before a prompt change ships, it runs against a small eval set: about 20 real past briefs and JDs, scored against the review rubric.
- **Privacy:** CV text sent for fit notes has the name, email, phone, photo, address, age and gender stripped first. Candidates can ask for a human-only review, which turns AI off for their applications.

```ts
const JobDescription = z.object({
  title: z.string(), department: z.string(), expBand: z.enum(['0–2','2–5','5–10','10+']),
  workMode: z.enum(['Onsite','Hybrid','Remote']), shift: z.string(),
  opportunity: z.string(),                    // "The opportunity"
  responsibilities: z.array(z.string()),      // concrete tasks, 4–8
  mustHave: z.array(z.string()), niceToHave: z.array(z.string()),
  whatWeLookFor: z.array(z.string()),
  first90Days: z.array(z.object({ by: z.enum(['30','60','90']), outcome: z.string(), measure: z.string() })),
  offers: z.array(z.string()),                // only from the company profile
  skills: z.array(z.string()),
  assessment: z.string(),                     // role-specific task
  openQuestions: z.array(z.string()),         // facts the recruiter must confirm
});
```

---

## 5. Data model (D1)

| Table | Key columns |
|---|---|
| `companies` | slug, name, brand tokens (accent colour, logo R2 key), careers domain, LinkedIn org URN, company profile JSON (approved facts for the AI), default distribution profile |
| `users` | email, name, role (`admin` / `recruiter` / `hiring_manager` / `viewer`), company scope |
| `jobs` | `req_code` (CG-YYYY-NNNN), company, title, department, locations, work mode, shift, exp min/max + band, seats, salary min/max/currency + show flag, incentive flag, status (`draft` → `pending_approval` → `open` → `paused` / `closed` / `filled`), posted_at, closes_at, owner, hiring manager, current_version |
| `job_versions` | job, version, sections JSON (schema above), source (`human` / `ai`), ai_run_id, author, created_at |
| `ai_runs` | task, model, prompt_version, input hash, tokens in/out/cache-read, latency, status, user |
| `channel_connections` | company, provider, account ref (member/org URN, employer ID), display name, scopes, token + refresh token (AES-GCM ciphertext + key version), expires_at, status (`active` / `expiring` / `expired` / `revoked` / `error`), connected_by |
| `distribution_profiles` | company, department (nullable = default), connection IDs, auto_publish, require_preview, repost_every_days |
| `post_copies` | job, provider, variant, text, hashtags, image R2 key, status (`draft` / `approved`), approved_by |
| `postings` | job, connection, provider, copy, status, external_id, external_url, scheduled_at, published_at, closed_at, attempts, last_error, **idempotency_key UNIQUE** |
| `posting_events` | posting, type, payload, at (full attempt history) |
| `candidates` | email UNIQUE, name, phone, city, years of experience, notice period, LinkedIn URL, CV R2 key, parsed profile JSON, deleted_at |
| `applications` | candidate × job (UNIQUE), source, source posting, stage, owner, AI fit JSON, pitch R2 key |
| `stage_history` | application, from, to, by, note, at |
| `consents` | candidate/email, type (`processing` / `campaigns`), interests, frequency, granted_at, withdrawn_at, source |
| `job_alerts` | email, saved query JSON, frequency, unsubscribe token, last_sent_at |
| `campaigns` | company, department, job, audience rule, sent, opens, clicks, re-applications |
| `webhook_endpoints` / `webhook_deliveries` | company website URL, secret (encrypted), events · delivery attempts |
| `api_keys` | company, hashed key, scope (read-only public API for company websites) |
| `job_stats_daily` | job, date, views, applies, by-source JSON (flushed from Redis counters) |
| `audit_log` | actor, action, entity, entity_id, diff JSON, at |

Key indexes: `jobs(company_id, status)`, `jobs(status, posted_at)`, `applications(job_id, stage)`, `postings(status, scheduled_at)`, `channel_connections(expires_at)`.

Rules: files never go in D1 (CVs and media live in R2). All multi-row writes go through `db.batch()`, which runs as a single transaction. Open jobs number in the hundreds, so search runs in the Worker over the cached open-jobs list using the demo's logic. SQLite FTS5 is the upgrade path if that ever gets slow.

---

## 6. Cache structure

**Three layers**

1. **Edge (Cloudflare cache):** public pages and the public API send `Cache-Control: s-maxage=60, stale-while-revalidate=300`. Publish, edit and close purge that job's URLs and the listing URLs.
2. **Redis:** computed JSON, counters, locks, rate limits and short-lived auth state.
3. **D1:** the source of truth. Redis is never the only copy of anything that matters.

**Pattern:** cache-aside with **versioned namespaces**. A write bumps a version counter (`INCR`), so new reads miss and rebuild under the new version, and old keys simply expire. This avoids wildcard deletes and race conditions.

All keys are prefixed `cth:{env}:`.

| Key | Type | TTL | Purpose |
|---|---|---|---|
| `ver:jobs:{scope}` | counter | none | List version for `all` or a company slug. Bumped on any publish, edit or close. |
| `ver:job:{jobId}` | counter | none | Version of one job |
| `c:job:{jobId}:{ver}` | string (JSON) | 1 h | Job detail for the job page and API |
| `c:jobs:{scope}:{ver}` | string (JSON) | 10 min | All open jobs for a scope; search and filters run on this in the Worker |
| `c:facets:{scope}:{ver}` | hash | 10 min | Department, location and shift counts; the hero scoreboard numbers |
| `c:feed:{channel}:{ver}` | string (XML) | 6 h | LinkedIn / Indeed XML feeds |
| `c:dash:{companyId}:{yyyymmddhh}` | string (JSON) | 5 min | Recruiter KPIs, funnel and sources |
| `ai:out:{sha256(task+promptVer+input)}` | string (JSON) | 24 h | Reuses the answer for an identical AI request |
| `ai:quota:{userId}:{yyyymmdd}` | counter | 48 h | Per-recruiter daily AI budget |
| `sess:{sid}` | hash | 30 d sliding | Candidate session |
| `otp:{emailHash}` | hash | 15 min | Login code + attempt count |
| `oauth:{state}` | hash | 10 min | PKCE verifier, user, provider, return URL during channel connect |
| `lock:post:{jobId}:{connectionId}` | string (`SET NX PX`) | 2 min | Stops a double post from retries or double clicks |
| `idem:{key}` | string (JSON) | 24 h | Replays the response for repeated `POST /publish` and `/apply` |
| `rl:{bucket}:{id}:{window}` | counter | window | Rate limits: apply, OTP and AI endpoints, plus provider quotas (e.g. `rl:li:{memberUrn}:day`) |
| `cnt:views:{yyyymmddhh}` | hash jobId → n | 48 h | Job page views. An hourly cron flushes them to `job_stats_daily`, so D1 gets one write per hour instead of one per view. |
| `cnt:src:{yyyymmdd}` | hash `{jobId}:{src}` → n | 48 h | Clicks per channel, flushed the same way |
| `chan:health:{connectionId}` | hash | 1 h | Last check, expiry and status for the Channels page |

**If Redis is down:**

- Reads fall through to D1.
- Writes never wait on Redis.
- Locks fall back to the D1 `idempotency_key` unique constraint, so a duplicate post is still impossible.
- Rate limits fail open (so candidates can still apply during an outage; Turnstile still guards public forms). Every Redis call has a 1.5 s timeout and a 10 s circuit breaker.

---

## 7. Connecting the group's websites

Each company website can use whichever option suits its stack:

| Option | For | How |
|---|---|---|
| **Hosted careers page** | Fastest; no work on their site | `careers.lakeb2b.com` (or `/c/lakeb2b`) served by this Worker in the company's brand colours, via a Workers custom domain if their DNS is on Cloudflare |
| **Embed widget** | Any site where someone can paste HTML | `<script src="https://careers.championsgroup.com/embed.js" data-company="lakeb2b"></script>` renders search, the job list and Apply (Shadow DOM, so their CSS can't break it) |
| **Public read API** | Custom-built sites | `GET /api/public/v1/jobs?company=lakeb2b`, `/jobs/:reqCode`, `/facets`. Uses a per-site API key, is edge-cached and supports CORS. |
| **Signed webhooks** | WordPress or CMS sites that store their own copy | `job.published` / `job.updated` / `job.closed`, signed with HMAC-SHA256 and retried through the Queue |

Every route ends at the same apply flow and the same database, so candidates, consents and source tracking stay in one place.

---

## 8. Security and compliance

- **Console access:** Cloudflare Access in front of `/console` and `/api/console`. The Worker verifies the Access JWT, then checks the role and company scope from D1.
- **Channel tokens:** encrypted with AES-GCM (WebCrypto). The key is a Worker secret with a version number so it can be rotated. Decrypted only inside the queue consumer.
- **Files:** private R2 bucket. Uploads limited by type and size. Signed download links last 5 minutes. Retention runs nightly and deletes CVs after the retention period unless the candidate opted in to future roles.
- **Consent and data protection:** consent for processing and opt-in to campaigns are recorded separately, as in the demo. Every email has an unsubscribe link. Candidates can export and delete their data. This covers India's DPDP Act, and GDPR for UK and EU applicants.
- **AI:** advisory only. Personal details are removed before CV analysis, every call is logged, and candidates can opt out to a human-only review.
- **Fraud:** every post and job page carries the "we never charge a fee" line and the `CG-` requisition ID.
- **Audit:** every stage change, consent change, publish and connection change is written to `audit_log`.

---

## 9. Repo layout and local development

```
champ-recruit/
├─ Dockerfile                 # node:22-slim + pnpm + wrangler; used for dev, CI and deploy
├─ docker-compose.yml
├─ wrangler.jsonc             # envs: dev, staging, production (separate D1, R2, Queues, Redis per env)
├─ migrations/                # D1 SQL (generated by drizzle-kit)
├─ src/
│  ├─ index.ts                # Hono app + queue() + scheduled()
│  ├─ env.ts                  # binding types
│  ├─ routes/{public,console,oauth,feeds}/
│  ├─ db/{schema.ts,queries/}
│  ├─ cache/{redis.ts,keys.ts,cacheAside.ts,rateLimit.ts}
│  ├─ channels/{adapter.ts,registry.ts,linkedin-member.ts,linkedin-org.ts,linkedin-feed.ts,
│  │            indeed.ts,naukri.ts,google-jobs.ts,owned-site.ts,webhook.ts,mock.ts}
│  ├─ publisher/{enqueue.ts,consumer.ts,scheduler.ts}
│  ├─ ai/{client.ts,schemas.ts,prompts/,tasks/{draftJd,taskify,reviewJd,channelCopy,screening,cvFit}.ts}
│  ├─ services/{email,storage,crypto,turnstile,access,indexing}.ts
│  └─ views/                  # Hono JSX careers portal, ported from the demo
├─ web/                       # React console (Vite) → built into Worker static assets
├─ tools/mock-channels/       # fake LinkedIn / Indeed / Naukri APIs for dev and tests
└─ test/                      # vitest-pool-workers + Playwright
```

```yaml
# docker-compose.yml (outline)
services:
  app:     { build: ., command: pnpm dev, ports: ["8787:8787"], volumes: [".:/app", "wrangler-state:/app/.wrangler"] }
  redis:   { image: redis:7-alpine }
  srh:     { image: hiett/serverless-redis-http:latest, ports: ["8079:80"],
             environment: { SRH_MODE: env, SRH_TOKEN: local, SRH_CONNECTION_STRING: "redis://redis:6379" } }
  mailpit: { image: axllent/mailpit, ports: ["8025:8025"] }
  mocks:   { build: ./tools/mock-channels, ports: ["9000:9000"] }
```

**CI (GitHub Actions):** lint → typecheck → unit and integration tests (in workerd) → build the Docker image → `wrangler d1 migrations apply` → `wrangler deploy` to staging on merge, then production on tag. Every pull request gets a preview deployment.

---

## 10. Delivery phases

Durations are rough and assume two full-stack developers. External approvals (marked ⏳) run in parallel and can hold up individual Phase 2 channels, but nothing else waits on them, because every adapter is built and tested against the mock first.

### Phase 0: Foundations (≈1 week)
- Repo, Docker Compose, wrangler environments, D1 schema and migrations, Upstash databases, R2 buckets, Queues, Cloudflare Access, CI.
- ⏳ **Start the external approvals on day one:**
  - LinkedIn developer app(s): Share on LinkedIn + Sign In with LinkedIn, and a Community Management API application (Development tier, then Standard).
  - Register the LinkedIn Limited Listings feed and turn on "Enable basic job posting" on each company page.
  - Indeed Job Sync developer agreement.
  - Quote for Naukri's integration module.
  - Google Search Console verification + Indexing API service account.
- **Done when:** `docker compose up` runs a hello-world against local D1 and Redis, and CI deploys to staging.

### Phase 1: Jobs, official sites and the AI JD studio (≈4–5 weeks)
- Job create, versions and approval. Company profiles. Roles.
- Careers portal ported from the demo and server-rendered: search, filters, job page with JSON-LD and Open Graph tags, multi-role apply with R2 CV upload, My applications with email-code login, alerts, talent community, two consents.
- Company website integration: hosted pages, public API, embed widget, webhooks. Jobs sitemap + Google Indexing API.
- Recruiter pipeline: table, stage changes, stage history, dashboard (KPIs, funnel, sources, requisition tracker).
- AI: draft from a brief, make it task-specific, review, channel copy.
- **First external channel:** LinkedIn profile posts from the recruiter's own account, with preview, tracked link and token-expiry reminders.
- **Done when:** a recruiter goes from a one-line brief to an approved JD that is live on the group site, one company site and their own LinkedIn profile in under 15 minutes, and an application from that LinkedIn post shows source = `linkedin_member`.

### Phase 2: Multi-channel auto-posting (≈4 weeks)
- Distribution profiles, the queue-based publisher with retries and DLQ, the per-channel status board, scheduling, auto-repost, and unpublish on close or filled.
- Adapters: LinkedIn company page ⏳, LinkedIn Limited Listings feed ⏳, Indeed Job Sync ⏳, Naukri ⏳, generic webhook.
- Job-card image generation for social posts (SVG template → PNG, stored in R2).
- AI screening questions.
- Channel → applications → hires report.
- **Done when:** approving a job posts it to every channel in its profile without manual steps (after the preview, if one is required), closing it removes it everywhere it can be removed, and a failed post shows a clear reason and a working Retry.

### Phase 3: Intelligence and re-engagement (≈4 weeks, then ongoing)
- CV parsing with prefill, AI fit notes (advisory, personal details removed), bench re-engagement campaigns (from the demo), alert digests, channel recommendation from our own hire data, reuse of similar past JDs, retention automation. Optional Facebook/X/WhatsApp adapters.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| LinkedIn rejects the Community Management API (Standard tier), and the same app cannot reapply | Apply only once there is a verified company page, a live privacy policy and a clean screen recording of the finished feature. Meanwhile, recruiters' profile posts and the Limited Listings feed still put jobs on LinkedIn. |
| LinkedIn Jobs listings stay "basic" (free, lower ranking, capped count) | Expected. For key roles, buy promoted listings in LinkedIn's own UI; the tracked link still gives us attribution. |
| Indeed or Naukri approval or pricing takes longer than planned | The adapter is built against the mock. The channel is switched on when access arrives, with no rework. |
| Recruiters' LinkedIn tokens expire every ~60 days | Expiry countdown, reminders at 7/3/1 days, `needs_reauth` status, and a one-click reconnect |
| Duplicate posts | Redis lock + D1 unique idempotency key + `Idempotency-Key` on the API |
| AI invents pay or benefits, or writes generic text | Company-profile grounding, `openQuestions`, mandatory human approval before publish, and the eval set before prompt changes |
| D1 single-writer limits | Recruiting write volume is low. Page views go to Redis counters, not D1. |
| A second tool also feeds our jobs to Indeed | Under Indeed's single-source policy, turn the other feed off and make this app the only source |

---

## 12. Decisions needed before Phase 0

1. **Docker:** is "Workers in production + Docker for dev, CI and deploy" acceptable (recommended)? Or does the production app have to run as a container (Cloudflare Containers, with D1 reached through a Worker)?
2. **Redis:** OK to use Upstash, with the primary region in Mumbai?
3. **Channels after LinkedIn:** confirm Naukri + Indeed + Google for Jobs. Is there an existing Naukri subscription to add the integration module to?
4. **Recruiter SSO:** Google Workspace or Microsoft 365?
5. **Company websites:** which sites are in scope for launch, and what each runs on (WordPress, custom, other). This decides hosted page vs widget vs API vs webhooks per site.
6. **LinkedIn ownership:** who is the admin of each company page and owns the developer app(s)? LinkedIn verification needs a page admin.
7. **Pay transparency:** show salary ranges publicly, per company or per role?
8. **Approval flow:** is HR or hiring-manager approval required before a job can be published, and for which companies?

---

## Sources checked for §3 (Nov 2026)

- LinkedIn Job Posting API overview, closed to new partners: https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview
- LinkedIn Community Management API app review (Development → Standard tier): https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review
- LinkedIn Posts API: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
- LinkedIn third-party job listing / XML feed guidelines: https://learn.microsoft.com/en-us/linkedin/talent/job-postings/xml-feeds-job-posting-guidelines
- Limited Listings setup and limits (vendor docs): https://help.workable.com/hc/en-us/articles/1500013010321 · https://knowledge.paycor.com/recruiting-post-jobs-on-linkedin-for-free-with-their-limited-postings
- Indeed Job Sync API and release notes: https://docs.indeed.com/job-sync-api · https://docs-plus.indeed.com/release-notes
- Naukri integration (example from an ATS vendor): https://support.greenhouse.io/hc/en-us/articles/16297968058651-Naukri-integration
- Cloudflare Containers GA (Apr 2026): https://developers.cloudflare.com/changelog/post/2026-04-13-containers-sandbox-ga/

---

## Build progress (updated 9 Nov 2026)

**Phase 0: done.** Repo, Docker Compose stack (Worker, Redis, SRH, mock channels), wrangler environments, D1 schema and migration, seed data from the demo, CI-ready test setup.

**Phase 1: done.**
- Careers portal ported from the demo, server-rendered, with JSON-LD, sitemap, company pages `/c/:slug` and CORS.
- Apply flow with CV upload to R2, email-code sign-in, alerts and talent community.
- Recruiter console: dashboard, jobs, JD studio with AI, publish, candidates, channels.
- Cloudflare Access auth and LinkedIn OAuth (member and page).
- Publisher with queue, locks, retries and needs-reconnect handling; owned-site webhooks; Google Indexing API; embed widget.

**Phase 2: mostly done.**
- Done: LinkedIn Limited Listings feed, Indeed (XML feed, or Job Sync API), Naukri webhook adapter, custom webhook, scheduling, auto-repost cron, update re-sync, close removal, channel → interviews → hires report.
- Remaining:
  - Distribution-profile editor in the console (API exists).
  - Job-card image generation.
  - AI screening questions.
  - Real-API field mapping for Indeed, Naukri and the LinkedIn feed once their docs and credentials arrive (mappers are isolated in `src/channels/boards.ts` and `feeds.ts`).

**Phase 3: not started.**

**Where the build differs from the plan above:**
- **Recruiter console stack:** plain ES modules with no build step, instead of React + Vite. Simpler to run in Docker; can move to React later without API changes.
- **Rate limits during a Redis outage:** public-form rate limits *fail open*, so candidates can still apply; Turnstile still protects the forms. The plan text in §6 said "fail closed".
- **Redis timeouts:** every Redis call has a 1.5 s timeout plus a 10 s circuit breaker. Tests showed that an unreachable Redis otherwise stalled every request.
- **Job status:** added an `approved` status between `pending_approval` and `open`.
- **Workers AI:** the binding is left out until Phase 3, because it needs a Cloudflare login even in local dev.
