import type { ChannelAdapter, AdapterCtx, PostCopy } from './adapter';
import { call, fillLink, PermanentError } from './adapter';
import type { PublicJobDetail } from '../services/jobs';

/**
 * LinkedIn Posts API (https://api.linkedin.com/rest/posts).
 * - linkedin_member: posts as the recruiter (w_member_social, self-serve "Share on LinkedIn").
 * - linkedin_org:    posts as the company page (w_organization_social, Community Management API — needs app review).
 * Both share this code; only the author URN differs. `config.apiBase` points at the mock server locally.
 */
const LINKEDIN_VERSION = '202510';
const MAX_COMMENTARY = 3000;

/** LinkedIn "little text" format reserves these characters; they must be backslash-escaped in commentary. */
export const escapeLittleText = (s: string) => s.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);

function base(ctx: AdapterCtx) {
  return (ctx.conn.config?.apiBase as string | undefined) ?? 'https://api.linkedin.com';
}

function headers(ctx: AdapterCtx) {
  if (!ctx.conn.token) throw new PermanentError('LinkedIn connection has no token. Reconnect it.');
  return {
    authorization: `Bearer ${ctx.conn.token}`,
    'linkedin-version': LINKEDIN_VERSION,
    'x-restli-protocol-version': '2.0.0',
    'content-type': 'application/json',
  };
}

function commentary(copy: PostCopy, url: string) {
  const tags = copy.hashtags.map((h) => `#${h.replace(/^#/, '').replace(/\W/g, '')}`).filter((h) => h.length > 1);
  // Hashtags are real hashtags (unescaped '#'); everything else is escaped.
  // Escape the text but not the URL (escaping would put backslashes into the link).
  const marker = 'TALENTHUBLINKMARKER';
  const body = escapeLittleText(fillLink(copy.text, marker)).replace(marker, url);
  return tags.length ? `${body}\n\n${tags.join(' ')}` : body;
}

function validate(job: PublicJobDetail, copy: PostCopy | null) {
  const problems: string[] = [];
  if (!copy?.text.trim()) problems.push('Write or generate the post text first');
  else if (copy.text.length > MAX_COMMENTARY - 300) problems.push(`Post is too long (${copy.text.length} characters; keep it under ${MAX_COMMENTARY - 300})`);
  if (job.status !== 'open') problems.push('The job must be open');
  return problems;
}

function adapter(provider: 'linkedin_member' | 'linkedin_org', label: string): ChannelAdapter {
  return {
    provider, label, mode: 'social', needsCopy: true,
    capabilities: { update: false, close: true },
    validate,
    async publish(ctx, job, copy) {
      const res = await call('LinkedIn', `${base(ctx)}/rest/posts`, {
        method: 'POST', headers: headers(ctx),
        body: JSON.stringify({
          author: ctx.conn.accountRef,
          commentary: commentary(copy!, ctx.trackedUrl),
          visibility: 'PUBLIC',
          distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
          content: { article: { source: ctx.trackedUrl, title: `${job.title} · ${job.ent}`, description: job.sum.slice(0, 250) } },
          lifecycleState: 'PUBLISHED',
          isReshareDisabledByAuthor: false,
        }),
      });
      const urn = res.headers.get('x-restli-id') ?? res.headers.get('x-linkedin-id');
      if (!urn) throw new PermanentError('LinkedIn accepted the post but returned no post ID');
      return { externalId: urn, url: `https://www.linkedin.com/feed/update/${urn}/` };
    },
    async close(ctx, externalId) {
      // Only when the recruiter chose "remove the post when the job closes" (config.deleteOnClose).
      if (!ctx.conn.config?.deleteOnClose) return;
      await call('LinkedIn', `${base(ctx)}/rest/posts/${encodeURIComponent(externalId)}`, { method: 'DELETE', headers: headers(ctx) });
    },
  };
}

export const linkedinMember = adapter('linkedin_member', 'LinkedIn · your profile');
export const linkedinOrg = adapter('linkedin_org', 'LinkedIn · company page');

// ---------- OAuth (member) ----------

export const LINKEDIN_SCOPES_MEMBER = 'openid profile email w_member_social';
export const LINKEDIN_SCOPES_ORG = 'w_organization_social r_organization_social rw_organization_admin';

export function authorizeUrl(clientId: string, redirectUri: string, state: string, scope: string) {
  const u = new URL('https://www.linkedin.com/oauth/v2/authorization');
  u.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state, scope }).toString();
  return u.toString();
}

export async function exchangeCode(clientId: string, secret: string, redirectUri: string, code: string) {
  const res = await call('LinkedIn OAuth', 'https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, client_secret: secret }),
  });
  return (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string; refresh_token_expires_in?: number; scope?: string };
}

export async function memberInfo(token: string, apiBase = 'https://api.linkedin.com') {
  const res = await call('LinkedIn', `${apiBase}/v2/userinfo`, { headers: { authorization: `Bearer ${token}` } });
  return (await res.json()) as { sub: string; name: string; email?: string };
}
