import type { ChannelAdapter } from './adapter';
import { call, fillLink, PermanentError } from './adapter';

/** A generic job board backed by tools/mock-channels. Lets the whole publish flow run locally. */
export const mockBoard: ChannelAdapter = {
  provider: 'mock', label: 'Mock job board', mode: 'api', needsCopy: true,
  capabilities: { update: true, close: true },
  validate: (_job, copy) => (copy?.text.trim() ? [] : ['Write or generate the listing text first']),
  async publish(ctx, job, copy) {
    const baseUrl = ctx.env.MOCK_CHANNELS_URL;
    if (!baseUrl) throw new PermanentError('MOCK_CHANNELS_URL is not set');
    const res = await call('Mock board', `${baseUrl}/board/jobs`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer mock' },
      body: JSON.stringify({ reqId: job.id, title: job.title, location: job.loc, body: fillLink(copy!.text, ctx.trackedUrl) }),
    });
    const data = (await res.json()) as { id: string; url: string };
    return { externalId: data.id, url: data.url };
  },
  async update(ctx, externalId, job, copy) {
    await call('Mock board', `${ctx.env.MOCK_CHANNELS_URL}/board/jobs/${externalId}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reqId: job.id, title: job.title, body: copy ? fillLink(copy.text, ctx.trackedUrl) : undefined }),
    });
  },
  async close(ctx, externalId) {
    await call('Mock board', `${ctx.env.MOCK_CHANNELS_URL}/board/jobs/${externalId}`, { method: 'DELETE' });
  },
};
