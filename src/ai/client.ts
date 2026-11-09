import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import type { Env } from '../env';
import { db, schema } from '../db/client';
import { redis, soft } from '../cache/redis';
import { keys, TTL } from '../cache/keys';
import { bad, now, sha256Hex, stableJson, uid } from '../lib/util';
import { PROMPT_VERSION } from './prompts';

export type Effort = 'low' | 'medium' | 'high';

export type AiTask<S extends z.ZodType> = {
  task: string;
  /** Stable context (rules, company profile, examples). Cached with cache_control. */
  system: string[];
  /** The changing part (brief, JD to review…). */
  user: string;
  schema: S;
  effort: Effort;
  maxTokens?: number;
  userId: string;
  /** Deterministic stand-in used when no API key is configured in dev/test. */
  mock: () => z.infer<S>;
};

export type AiResult<T> = { output: T; runId: string; cached: boolean; mode: 'live' | 'mock' };

const DAILY_LIMIT = 200;

export function aiMode(env: Env): 'live' | 'mock' | 'off' {
  if (env.AI_MODE === 'mock') return 'mock';
  if (env.ANTHROPIC_API_KEY) return 'live';
  return env.ENVIRONMENT === 'dev' || env.ENVIRONMENT === 'test' ? 'mock' : 'off';
}

export async function runAi<S extends z.ZodType>(env: Env, t: AiTask<S>): Promise<AiResult<z.infer<S>>> {
  const mode = aiMode(env);
  if (mode === 'off') bad('AI assistance is not configured (ANTHROPIC_API_KEY missing)', 503);

  const day = new Date().toISOString().slice(0, 10);
  const quotaKey = keys(env).aiQuota(t.userId, day);
  const used = await soft(async () => {
    const p = redis(env).pipeline();
    p.incr(quotaKey);
    p.expire(quotaKey, TTL.aiQuota);
    const [n] = await p.exec<[number, number]>();
    return n;
  }, 0, 'ai-quota');
  if (used > DAILY_LIMIT) bad(`Daily AI limit reached (${DAILY_LIMIT} requests). It resets at midnight UTC.`, 429);

  const model = env.AI_MODEL || 'claude-opus-5-5';
  const inputHash = await sha256Hex(stableJson({ task: t.task, v: PROMPT_VERSION, model, mode, system: t.system, user: t.user, effort: t.effort }));
  const cacheKey = keys(env).aiOut(inputHash);
  const hit = await soft(() => redis(env).get<string>(cacheKey), null);
  const runId = uid();
  const log = (row: Partial<typeof schema.aiRuns.$inferInsert>) =>
    db(env).insert(schema.aiRuns).values({ id: runId, task: t.task, model: mode === 'mock' ? 'mock' : model, promptVersion: PROMPT_VERSION, inputHash, userId: t.userId, createdAt: now(), status: 'ok', ...row });

  if (hit) {
    await log({ status: 'cached' });
    return { output: JSON.parse(hit), runId, cached: true, mode };
  }

  const started = Date.now();
  let output: z.infer<S>;
  if (mode === 'mock') {
    output = t.schema.parse(t.mock());
    await log({ latencyMs: Date.now() - started });
  } else {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 120_000 });
    try {
      const res = await client.beta.messages.parse({
        model,
        max_tokens: t.maxTokens ?? 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: t.system.map((text, i) => ({ type: 'text' as const, text, ...(i === t.system.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}) })),
        messages: [{ role: 'user', content: t.user }],
        output_config: { effort: t.effort, format: betaZodOutputFormat(t.schema) },
      });
      const usage = { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, cacheReadTokens: res.usage.cache_read_input_tokens ?? 0, latencyMs: Date.now() - started };
      if (res.stop_reason === 'refusal') {
        await log({ ...usage, status: 'refused' });
        bad('The AI declined this request. Edit the brief and try again, or write this part by hand.', 422);
      }
      if (res.stop_reason === 'max_tokens' || !res.parsed_output) {
        await log({ ...usage, status: 'error', error: `stop_reason=${res.stop_reason}` });
        bad('The AI response was incomplete. Try again with a shorter input.', 422);
      }
      output = res.parsed_output as z.infer<S>;
      await log(usage);
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) {
        await log({ status: 'error', error: 'rate_limited', latencyMs: Date.now() - started });
        bad('The AI service is busy. Try again in a minute.', 429);
      }
      if (err instanceof Anthropic.APIError) {
        await log({ status: 'error', error: `${err.status} ${err.message}`.slice(0, 500), latencyMs: Date.now() - started });
        bad('The AI service returned an error. Try again shortly.', 503);
      }
      throw err;
    }
  }
  await soft(() => redis(env).set(cacheKey, JSON.stringify(output), { ex: TTL.aiOut }), null);
  return { output, runId, cached: false, mode };
}
