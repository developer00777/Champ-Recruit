import type { Provider } from '../db/schema';
import type { ChannelAdapter } from './adapter';
import { ownedSite } from './owned-site';
import { googleJobs } from './google-jobs';
import { linkedinMember, linkedinOrg } from './linkedin';
import { mockBoard } from './mock';
import { linkedinFeed } from './feeds';
import { indeed, naukri, webhookChannel } from './boards';

const ADAPTERS: Partial<Record<Provider, ChannelAdapter>> = {
  owned_site: ownedSite,
  google_jobs: googleJobs,
  linkedin_member: linkedinMember,
  linkedin_org: linkedinOrg,
  linkedin_feed: linkedinFeed,
  indeed,
  naukri,
  webhook: webhookChannel,
  mock: mockBoard,
};

export function adapterFor(p: Provider): ChannelAdapter | undefined {
  return ADAPTERS[p];
}

export function registerAdapter(a: ChannelAdapter) {
  ADAPTERS[a.provider] = a;
}

export const allAdapters = () => Object.values(ADAPTERS) as ChannelAdapter[];
