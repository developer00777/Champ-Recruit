import type { PublishMessage } from './publisher/types';

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  PUBLISH_QUEUE: Queue<PublishMessage>;

  ENVIRONMENT: 'dev' | 'test' | 'staging' | 'production';
  APP_URL: string;
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  MOCK_CHANNELS_URL: string;
  AI_MODEL: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;

  ANTHROPIC_API_KEY?: string;
  /** "mock" = template-based AI responses (local demos and tests without an API key). */
  AI_MODE?: string;
  TOKEN_ENC_KEY: string;
  DEV_AUTH_EMAIL?: string;
  APP_SECRET: string;
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
}

export type AppUser = {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'recruiter' | 'hiring_manager' | 'viewer';
  companyIds: string[] | null;
};

export type AppEnv = { Bindings: Env; Variables: { user: AppUser; requestId: string } };
