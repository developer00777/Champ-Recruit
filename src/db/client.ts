import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';
import type { Env } from '../env';
import { uid, now } from '../lib/util';

export type DB = ReturnType<typeof db>;

export function db(env: Pick<Env, 'DB'>) {
  return drizzle(env.DB, { schema });
}

export async function audit(env: Pick<Env, 'DB'>, actor: string, action: string, entity: string, entityId: string, diff?: Record<string, unknown>) {
  await db(env).insert(schema.auditLog).values({ id: uid(), actor, action, entity, entityId, diff: diff ?? null, at: now() });
}

export { schema };
