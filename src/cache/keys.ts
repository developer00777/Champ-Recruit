import type { Env } from '../env';

/**
 * The single source of Redis key names (see PLAN.md §6). Every key is prefixed
 * `cth:{env}:` so staging and production can share an Upstash database if needed.
 */
export function keys(env: Pick<Env, 'ENVIRONMENT'>) {
  const p = `cth:${env.ENVIRONMENT}:`;
  return {
    // Namespace versions — bumped on writes; never expire.
    verJobs: (scope: string) => `${p}ver:jobs:${scope}`,
    verJob: (jobId: string) => `${p}ver:job:${jobId}`,
    // Cache entries (versioned).
    job: (jobId: string, ver: number) => `${p}c:job:${jobId}:${ver}`,
    jobs: (scope: string, ver: number) => `${p}c:jobs:${scope}:${ver}`,
    facets: (scope: string, ver: number) => `${p}c:facets:${scope}:${ver}`,
    feed: (channel: string, ver: number) => `${p}c:feed:${channel}:${ver}`,
    dash: (companyId: string, hour: string) => `${p}c:dash:${companyId}:${hour}`,
    // AI
    aiOut: (hash: string) => `${p}ai:out:${hash}`,
    aiQuota: (userId: string, day: string) => `${p}ai:quota:${userId}:${day}`,
    // Auth / sessions
    sess: (sid: string) => `${p}sess:${sid}`,
    otp: (emailHash: string) => `${p}otp:${emailHash}`,
    oauth: (state: string) => `${p}oauth:${state}`,
    // Publishing safety
    lockPost: (jobId: string, connectionId: string) => `${p}lock:post:${jobId}:${connectionId}`,
    idem: (key: string) => `${p}idem:${key}`,
    // Rate limits
    rl: (bucket: string, id: string, window: string | number) => `${p}rl:${bucket}:${id}:${window}`,
    // Write-behind counters
    views: (hour: string) => `${p}cnt:views:${hour}`,
    clicks: (day: string) => `${p}cnt:src:${day}`,
    chanHealth: (connectionId: string) => `${p}chan:health:${connectionId}`,
  };
}

export const TTL = {
  job: 3600,
  jobs: 600,
  facets: 600,
  feed: 6 * 3600,
  dash: 300,
  aiOut: 86400,
  aiQuota: 2 * 86400,
  sess: 30 * 86400,
  otp: 900,
  oauth: 600,
  lockPost: 120,
  idem: 86400,
  counters: 2 * 86400,
  chanHealth: 3600,
} as const;
