import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { AppEnv } from '../../env';
import { requireRecruiter, canWrite, canSeeCompany } from '../../services/access';
import { redis } from '../../cache/redis';
import { keys, TTL } from '../../cache/keys';
import { db, schema, audit } from '../../db/client';
import { encrypt } from '../../lib/crypto';
import { bad, now, uid } from '../../lib/util';
import { authorizeUrl, exchangeCode, memberInfo, LINKEDIN_SCOPES_MEMBER, LINKEDIN_SCOPES_ORG } from '../../channels/linkedin';

/**
 * "Connect LinkedIn" for recruiters.
 *   GET /oauth/linkedin/start?companyId=…&kind=linkedin_member|linkedin_org[&orgUrn=urn:li:organization:123]
 *   GET /oauth/linkedin/callback?code=…&state=…
 * Tokens are AES-GCM encrypted before they touch D1.
 */
export const linkedinOAuth = new Hono<AppEnv>();
linkedinOAuth.use('*', requireRecruiter);

const redirectUri = (appUrl: string) => `${appUrl}/oauth/linkedin/callback`;

linkedinOAuth.get('/start', async (c) => {
  const u = c.get('user');
  if (!canWrite(u)) bad('Your role is read-only', 403);
  if (!c.env.LINKEDIN_CLIENT_ID || !c.env.LINKEDIN_CLIENT_SECRET) bad('LinkedIn app credentials are not configured (LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET)', 503);
  const companyId = c.req.query('companyId') ?? '';
  const kind = c.req.query('kind') === 'linkedin_org' ? 'linkedin_org' : 'linkedin_member';
  const orgUrn = c.req.query('orgUrn');
  if (!canSeeCompany(u, companyId)) bad('Not your company', 403);
  if (kind === 'linkedin_org' && !/^urn:li:organization:\d+$/.test(orgUrn ?? '')) bad('Give the company page URN, e.g. urn:li:organization:12345', 422);
  const state = uid().replace(/-/g, '');
  await redis(c.env).set(keys(c.env).oauth(state), JSON.stringify({ userId: u.id, companyId, kind, orgUrn }), { ex: TTL.oauth });
  const scope = kind === 'linkedin_org' ? `openid profile ${LINKEDIN_SCOPES_ORG}` : LINKEDIN_SCOPES_MEMBER;
  return c.redirect(authorizeUrl(c.env.LINKEDIN_CLIENT_ID, redirectUri(c.env.APP_URL), state, scope));
});

linkedinOAuth.get('/callback', async (c) => {
  const { code, state, error, error_description } = c.req.query();
  if (error) return c.redirect(`/console#/channels?error=${encodeURIComponent(error_description ?? error)}`);
  if (!code || !state) bad('Missing code or state', 400);
  const k = keys(c.env).oauth(state);
  const raw = await redis(c.env).get<string>(k);
  if (!raw) bad('This connect link expired. Start again from the Channels page.', 400);
  await redis(c.env).del(k);
  const st = JSON.parse(raw) as { userId: string; companyId: string; kind: 'linkedin_member' | 'linkedin_org'; orgUrn?: string };
  if (st.userId !== c.get('user').id) bad('This connect link belongs to another user', 403);

  const tok = await exchangeCode(c.env.LINKEDIN_CLIENT_ID!, c.env.LINKEDIN_CLIENT_SECRET!, redirectUri(c.env.APP_URL), code);
  const me = await memberInfo(tok.access_token);
  const accountRef = st.kind === 'linkedin_org' ? st.orgUrn! : `urn:li:person:${me.sub}`;
  const displayName = st.kind === 'linkedin_org' ? `Company page ${st.orgUrn} (via ${me.name})` : `${me.name} on LinkedIn`;
  const d = db(c.env);
  const id = `conn_${uid().replace(/-/g, '').slice(0, 10)}`;
  await d.insert(schema.channelConnections).values({
    id, companyId: st.companyId, provider: st.kind, accountRef, displayName, scopes: tok.scope ?? null,
    tokenEnc: await encrypt(c.env.TOKEN_ENC_KEY, tok.access_token),
    refreshEnc: tok.refresh_token ? await encrypt(c.env.TOKEN_ENC_KEY, tok.refresh_token) : null,
    expiresAt: now() + tok.expires_in * 1000, status: 'active', connectedBy: st.userId, config: null, createdAt: now(),
  });
  // Older connections for the same account are superseded.
  const others = (await d.select().from(schema.channelConnections)).filter((x) => x.id !== id && x.provider === st.kind && x.accountRef === accountRef && x.status !== 'revoked');
  for (const o of others) await d.update(schema.channelConnections).set({ status: 'revoked', tokenEnc: null }).where(eq(schema.channelConnections.id, o.id));
  await audit(c.env, c.get('user').email, 'channel.connect', 'connection', id, { provider: st.kind });
  return c.redirect('/console#/channels?connected=1');
});
