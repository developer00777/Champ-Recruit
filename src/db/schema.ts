import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

/** All timestamps are epoch milliseconds. All ids are text (UUID or req code). */
const ts = (name: string) => integer(name);
const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();

// ---------- Organisation ----------

export type CompanyProfile = {
  tagline?: string;
  offers: string[];            // approved "What working here offers" lines — the only benefits the AI may state
  locations: string[];
  shifts: string[];
  incentivePolicy?: string;
  culture?: string[];
  about?: string;
};

export const companies = sqliteTable('companies', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  accent: text('accent').notNull().default('#F59A3C'),
  logoKey: text('logo_key'),
  careersDomain: text('careers_domain'),
  linkedinOrgUrn: text('linkedin_org_urn'),
  profile: json<CompanyProfile>('profile').notNull(),
  requireApproval: integer('require_approval', { mode: 'boolean' }).notNull().default(false),
  createdAt: ts('created_at').notNull(),
});

export const USER_ROLES = ['admin', 'recruiter', 'hiring_manager', 'viewer'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: text('role', { enum: USER_ROLES }).notNull().default('recruiter'),
  /** null = all companies */
  companyIds: json<string[] | null>('company_ids'),
  createdAt: ts('created_at').notNull(),
});

// ---------- Jobs ----------

export const JOB_STATUSES = ['draft', 'pending_approval', 'approved', 'open', 'paused', 'closed', 'filled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const WORK_MODES = ['Onsite', 'Hybrid', 'Remote'] as const;
export const EXP_BANDS = ['0–2 yrs', '2–5 yrs', '5–10 yrs', '10+ yrs'] as const;

/** The house JD format — mirrors the demo's job page sections. */
export type JobSections = {
  opportunity: string;
  responsibilities: string[];
  mustHave: string[];
  niceToHave: string[];
  whatWeLookFor: string[];
  first90Days: { by: '30' | '60' | '90'; outcome: string; measure: string }[];
  offers: string[];
  skills: string[];
  assessment?: string;
};

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),                       // = req code, e.g. CG-2026-1103
  companyId: text('company_id').notNull().references(() => companies.id),
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  department: text('department').notNull(),
  location: text('location').notNull(),
  workMode: text('work_mode', { enum: WORK_MODES }).notNull(),
  shift: text('shift').notNull(),
  expLabel: text('exp_label').notNull(),             // "0–2 yrs" as shown on the card
  expBand: integer('exp_band').notNull(),            // index into EXP_BANDS
  seats: integer('seats').notNull().default(1),
  salaryMin: integer('salary_min'),
  salaryMax: integer('salary_max'),
  salaryCurrency: text('salary_currency').default('INR'),
  showSalary: integer('show_salary', { mode: 'boolean' }).notNull().default(false),
  incentive: integer('incentive', { mode: 'boolean' }).notNull().default(false),
  tags: json<string[]>('tags').notNull(),
  summary: text('summary').notNull(),                // one-line card summary
  status: text('status', { enum: JOB_STATUSES }).notNull().default('draft'),
  currentVersion: integer('current_version').notNull().default(1),
  ownerId: text('owner_id').references(() => users.id),
  hiringManagerId: text('hiring_manager_id').references(() => users.id),
  postedAt: ts('posted_at'),
  closesAt: ts('closes_at'),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
}, (t) => [
  index('jobs_company_status').on(t.companyId, t.status),
  index('jobs_status_posted').on(t.status, t.postedAt),
]);

export const jobVersions = sqliteTable('job_versions', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull().references(() => jobs.id),
  version: integer('version').notNull(),
  sections: json<JobSections>('sections').notNull(),
  source: text('source', { enum: ['human', 'ai'] }).notNull().default('human'),
  aiRunId: text('ai_run_id'),
  authorId: text('author_id'),
  createdAt: ts('created_at').notNull(),
}, (t) => [uniqueIndex('job_versions_job_version').on(t.jobId, t.version)]);

export const aiRuns = sqliteTable('ai_runs', {
  id: text('id').primaryKey(),
  task: text('task').notNull(),
  model: text('model').notNull(),
  promptVersion: text('prompt_version').notNull(),
  inputHash: text('input_hash').notNull(),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  cacheReadTokens: integer('cache_read_tokens'),
  latencyMs: integer('latency_ms'),
  status: text('status', { enum: ['ok', 'error', 'refused', 'cached'] }).notNull(),
  error: text('error'),
  userId: text('user_id'),
  createdAt: ts('created_at').notNull(),
});

// ---------- Channels & distribution ----------

export const PROVIDERS = [
  'owned_site', 'google_jobs', 'linkedin_member', 'linkedin_org', 'linkedin_feed', 'indeed', 'naukri', 'webhook', 'mock',
] as const;
export type Provider = (typeof PROVIDERS)[number];

export const channelConnections = sqliteTable('channel_connections', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  provider: text('provider', { enum: PROVIDERS }).notNull(),
  accountRef: text('account_ref').notNull(),          // member URN, org URN, employer id…
  displayName: text('display_name').notNull(),
  scopes: text('scopes'),
  tokenEnc: text('token_enc'),                        // AES-GCM ciphertext, base64
  refreshEnc: text('refresh_enc'),
  keyVersion: integer('key_version').notNull().default(1),
  config: json<Record<string, unknown>>('config'),
  expiresAt: ts('expires_at'),
  status: text('status', { enum: ['active', 'expiring', 'expired', 'revoked', 'error'] }).notNull().default('active'),
  lastOkAt: ts('last_ok_at'),
  connectedBy: text('connected_by'),
  createdAt: ts('created_at').notNull(),
}, (t) => [index('conn_expires').on(t.expiresAt)]);

export const distributionProfiles = sqliteTable('distribution_profiles', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  department: text('department'),                    // null = company default
  connectionIds: json<string[]>('connection_ids').notNull(),
  autoPublish: integer('auto_publish', { mode: 'boolean' }).notNull().default(false),
  requirePreview: integer('require_preview', { mode: 'boolean' }).notNull().default(true),
  repostEveryDays: integer('repost_every_days'),
});

export const postCopies = sqliteTable('post_copies', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull().references(() => jobs.id),
  provider: text('provider', { enum: PROVIDERS }).notNull(),
  variant: integer('variant').notNull().default(1),
  text: text('text').notNull(),
  hashtags: json<string[]>('hashtags'),
  imageKey: text('image_key'),
  status: text('status', { enum: ['draft', 'approved'] }).notNull().default('draft'),
  approvedBy: text('approved_by'),
  createdAt: ts('created_at').notNull(),
});

export const POSTING_STATUSES = ['scheduled', 'queued', 'posting', 'live', 'failed', 'needs_reauth', 'closing', 'closed', 'stale'] as const;
export type PostingStatus = (typeof POSTING_STATUSES)[number];

export const postings = sqliteTable('postings', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull().references(() => jobs.id),
  connectionId: text('connection_id').notNull().references(() => channelConnections.id),
  provider: text('provider', { enum: PROVIDERS }).notNull(),
  copyId: text('copy_id'),
  run: integer('run').notNull().default(1),
  status: text('status', { enum: POSTING_STATUSES }).notNull().default('queued'),
  externalId: text('external_id'),
  externalUrl: text('external_url'),
  scheduledAt: ts('scheduled_at'),
  publishedAt: ts('published_at'),
  closedAt: ts('closed_at'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  idempotencyKey: text('idempotency_key').notNull(),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
}, (t) => [
  uniqueIndex('postings_idem').on(t.idempotencyKey),
  index('postings_status_sched').on(t.status, t.scheduledAt),
  index('postings_job').on(t.jobId),
]);

export const postingEvents = sqliteTable('posting_events', {
  id: text('id').primaryKey(),
  postingId: text('posting_id').notNull().references(() => postings.id),
  type: text('type').notNull(),
  detail: json<Record<string, unknown>>('detail'),
  at: ts('at').notNull(),
});

// ---------- Candidates & applications ----------

export const candidates = sqliteTable('candidates', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  phone: text('phone'),
  city: text('city'),
  expYears: text('exp_years'),
  notice: text('notice'),
  linkedinUrl: text('linkedin_url'),
  cvKey: text('cv_key'),
  cvText: text('cv_text'),
  pitch: text('pitch'),
  parsedProfile: json<Record<string, unknown>>('parsed_profile'),
  humanOnlyReview: integer('human_only_review', { mode: 'boolean' }).notNull().default(false),
  createdAt: ts('created_at').notNull(),
  deletedAt: ts('deleted_at'),
});

export const STAGES = ['Applied', 'Screening', 'Assessment', 'Interview', 'Offer', 'Hired', 'Not selected', 'Withdrawn'] as const;
export type Stage = (typeof STAGES)[number];

export const applications = sqliteTable('applications', {
  id: text('id').primaryKey(),
  candidateId: text('candidate_id').notNull().references(() => candidates.id),
  jobId: text('job_id').notNull().references(() => jobs.id),
  source: text('source').notNull().default('careers_site'),
  sourcePostingId: text('source_posting_id'),
  stage: text('stage', { enum: STAGES }).notNull().default('Applied'),
  ownerId: text('owner_id'),
  aiFit: json<Record<string, unknown>>('ai_fit'),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
}, (t) => [
  uniqueIndex('applications_candidate_job').on(t.candidateId, t.jobId),
  index('applications_job_stage').on(t.jobId, t.stage),
]);

export const stageHistory = sqliteTable('stage_history', {
  id: text('id').primaryKey(),
  applicationId: text('application_id').notNull().references(() => applications.id),
  fromStage: text('from_stage'),
  toStage: text('to_stage').notNull(),
  byUser: text('by_user'),
  note: text('note'),
  at: ts('at').notNull(),
});

export const consents = sqliteTable('consents', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  candidateId: text('candidate_id'),
  type: text('type', { enum: ['processing', 'campaigns'] }).notNull(),
  interests: json<string[]>('interests'),
  frequency: text('frequency'),
  source: text('source'),
  grantedAt: ts('granted_at').notNull(),
  withdrawnAt: ts('withdrawn_at'),
}, (t) => [index('consents_email').on(t.email)]);

export const jobAlerts = sqliteTable('job_alerts', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  label: text('label').notNull(),
  query: json<Record<string, unknown>>('query').notNull(),
  frequency: text('frequency').notNull(),
  unsubToken: text('unsub_token').notNull().unique(),
  lastSentAt: ts('last_sent_at'),
  createdAt: ts('created_at').notNull(),
  stoppedAt: ts('stopped_at'),
});

export const campaigns = sqliteTable('campaigns', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),
  department: text('department').notNull(),
  jobId: text('job_id'),
  audienceRule: json<Record<string, unknown>>('audience_rule').notNull(),
  sent: integer('sent').notNull().default(0),
  opens: integer('opens').notNull().default(0),
  clicks: integer('clicks').notNull().default(0),
  reapplies: integer('reapplies').notNull().default(0),
  createdBy: text('created_by'),
  sentAt: ts('sent_at'),
});

// ---------- Website integration ----------

export const webhookEndpoints = sqliteTable('webhook_endpoints', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  url: text('url').notNull(),
  secretEnc: text('secret_enc').notNull(),
  events: json<string[]>('events').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: ts('created_at').notNull(),
});

export const webhookDeliveries = sqliteTable('webhook_deliveries', {
  id: text('id').primaryKey(),
  endpointId: text('endpoint_id').notNull(),
  event: text('event').notNull(),
  status: integer('status'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  at: ts('at').notNull(),
});

export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  companyId: text('company_id'),          // null = all companies
  label: text('label').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  createdAt: ts('created_at').notNull(),
  revokedAt: ts('revoked_at'),
});

// ---------- Stats & audit ----------

export const jobStatsDaily = sqliteTable('job_stats_daily', {
  jobId: text('job_id').notNull(),
  date: text('date').notNull(),          // YYYY-MM-DD
  views: integer('views').notNull().default(0),
  clicksBySource: json<Record<string, number>>('clicks_by_source'),
}, (t) => [uniqueIndex('job_stats_pk').on(t.jobId, t.date)]);

export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull(),
  diff: json<Record<string, unknown>>('diff'),
  at: ts('at').notNull(),
}, (t) => [index('audit_entity').on(t.entity, t.entityId)]);
