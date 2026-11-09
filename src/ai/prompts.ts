import type { CompanyProfile, JobSections } from '../db/schema';

/** Bump when any prompt text changes; stored on every ai_runs row and part of the AI cache key. */
export const PROMPT_VERSION = '2026-11-09.1';

export const HOUSE_RULES = `You write and improve job descriptions for Champions Group, a global group of 20 businesses (B2B data, marketing, SaaS, hospitality and more), headquartered in Singapore with its main hiring hub in Bengaluru. Many sales and lead-generation roles work US or UK shifts.

House rules — follow all of them:
1. Facts about pay, benefits, perks, bonuses, insurance, leave or culture come ONLY from the company profile you are given. Never invent them. If the brief needs one that is missing, add a short question to openQuestions instead.
2. Be specific. Prefer concrete tasks with a volume, tool or outcome ("Run 3-step email and LinkedIn sequences to 60 new contacts a day") over vague ones ("Handle outreach"). Only use numbers the brief or company profile supports, or that are clearly typical targets the recruiter can edit; if you assume a number, say so in openQuestions.
3. Plain, inclusive language: no gendered words, no "rockstar/ninja", no age proxies ("young", "digital native"), no unnecessary degree requirements. Use "you".
4. Never ask candidates for money. Never promise outcomes ("guaranteed placement").
5. Keep it tight: responsibilities 4–8 bullets, must-haves 3–6, nice-to-haves 2–4. Each bullet under 25 words.
6. British/Indian English spelling (organise, programme).`;

export const JD_FORMAT = `The house JD format has these sections, in order:
- opportunity: 2–3 sentences on the team, how many seats, where and how they work (mode and shift).
- responsibilities: concrete tasks.
- mustHave: requirements a candidate must meet.
- niceToHave: helpful extras.
- whatWeLookFor: attitude and working style, 1–2 short paragraphs.
- first90Days: exactly three checkpoints (by 30, 60, 90 days), each with a measurable check.
- offers: only from the company profile.
- skills: 4–8 short tags used for search and matching.
- assessment: one role-specific task (a mock cold call, a data sheet test, a short case…).`;

export function companyBlock(name: string, p: CompanyProfile) {
  return `<company_profile name="${name}">
About: ${p.about ?? '—'}
Locations: ${p.locations.join(', ')}
Shifts offered: ${p.shifts.join(', ')}
Incentive policy: ${p.incentivePolicy ?? 'none stated'}
Culture: ${(p.culture ?? []).join('; ') || '—'}
Approved "what we offer" lines (the ONLY benefits you may state):
${p.offers.map((o) => `- ${o}`).join('\n')}
</company_profile>`;
}

export function exampleBlock(examples: { title: string; department: string; sections: JobSections }[]) {
  if (!examples.length) return '';
  return `<approved_examples>\n${examples.map((e) => `<example title="${e.title}" department="${e.department}">\n${JSON.stringify(e.sections)}\n</example>`).join('\n')}\n</approved_examples>`;
}

export const CHANNEL_GUIDES: Record<string, string> = {
  linkedin_member: 'A LinkedIn post from the recruiter\'s personal profile. First person, warm, 600–1,200 characters. Hook in the first line (it shows before "…see more"). 3–5 short lines or bullets on what the role is and who fits. End with the link placeholder {{link}} on its own line. 3–5 hashtags, returned separately.',
  linkedin_org: 'A LinkedIn post from the company page. Company voice ("we"), 600–1,200 characters. Hook first line, the role in 3–4 bullets, who should apply, then {{link}} on its own line. 3–5 hashtags, returned separately.',
  naukri: 'A Naukri job description body. Plain text, no emojis, 1,500–2,500 characters: summary, responsibilities, requirements, then "Apply at {{link}}". Hashtags: return an empty list.',
  indeed: 'An Indeed job description body. Plain text, 1,500–2,500 characters: summary, responsibilities, requirements, what we offer (profile lines only), then "Apply at {{link}}". Hashtags: return an empty list.',
  whatsapp: 'A WhatsApp / Slack referral blurb. Under 400 characters, one emoji maximum, title + 2 lines + {{link}}. Hashtags: return an empty list.',
  mock: 'A short job board listing, under 800 characters, ending with {{link}}. Hashtags: return an empty list.',
};
