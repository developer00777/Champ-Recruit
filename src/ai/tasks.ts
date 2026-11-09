import { and, desc, eq } from 'drizzle-orm';
import type { Env } from '../env';
import { db, schema } from '../db/client';
import type { CompanyProfile, JobSections } from '../db/schema';
import { runAi } from './client';
import { HOUSE_RULES, JD_FORMAT, CHANNEL_GUIDES, companyBlock, exampleBlock } from './prompts';
import { JdDraft, TaskifyResult, ReviewResult, ChannelCopy } from './schemas';
import { bad } from '../lib/util';

type Company = { id: string; name: string; profile: CompanyProfile };

async function loadCompany(env: Env, companyId: string): Promise<Company> {
  const c = await db(env).select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
  if (!c) bad('Unknown company', 404);
  return c;
}

/** Two approved JDs from the same department (or any), used as style examples. */
async function examples(env: Env, department?: string, excludeId?: string) {
  const rows = await db(env)
    .select({ title: schema.jobs.title, department: schema.jobs.department, id: schema.jobs.id, sections: schema.jobVersions.sections })
    .from(schema.jobs)
    .innerJoin(schema.jobVersions, and(eq(schema.jobVersions.jobId, schema.jobs.id), eq(schema.jobVersions.version, schema.jobs.currentVersion)))
    .where(eq(schema.jobs.status, 'open'))
    .orderBy(desc(schema.jobs.postedAt))
    .limit(40);
  const pool = rows.filter((r) => r.id !== excludeId);
  const same = pool.filter((r) => department && r.department.toLowerCase() === department.toLowerCase());
  return [...same, ...pool.filter((r) => !same.includes(r))].slice(0, 2);
}

const sentence = (s: string) => s.trim().replace(/\s+/g, ' ');

// ---------- Draft from brief ----------

export async function draftJd(env: Env, userId: string, input: { companyId: string; brief: string; department?: string }) {
  const co = await loadCompany(env, input.companyId);
  const ex = await examples(env, input.department);
  return runAi(env, {
    task: 'jd.draft', userId, effort: 'medium', schema: JdDraft,
    system: [HOUSE_RULES, JD_FORMAT, `${companyBlock(co.name, co.profile)}\n${exampleBlock(ex)}`],
    user: `Write a complete job description for ${co.name} from this recruiter brief.${input.department ? ` Department: ${input.department}.` : ''}\n\n<brief>\n${input.brief}\n</brief>`,
    mock: () => mockDraft(co, input.brief, input.department),
  });
}

// ---------- Make it task-specific ----------

export async function taskifyJd(env: Env, userId: string, input: { companyId: string; title: string; department: string; sections: JobSections }) {
  const co = await loadCompany(env, input.companyId);
  return runAi(env, {
    task: 'jd.taskify', userId, effort: 'medium', schema: TaskifyResult,
    system: [HOUSE_RULES, JD_FORMAT, companyBlock(co.name, co.profile)],
    user: `Make this ${input.title} (${input.department}) job description more task-specific. For every responsibility or requirement that is vague, return a rewrite with a concrete volume, tool or outcome. Skip lines that are already specific. Also propose measurable first-90-days checkpoints and one role-specific assessment task.\n\n<jd>\n${JSON.stringify({ responsibilities: input.sections.responsibilities, mustHave: input.sections.mustHave, niceToHave: input.sections.niceToHave })}\n</jd>`,
    mock: () => mockTaskify(input),
  });
}

// ---------- Review ----------

export async function reviewJd(env: Env, userId: string, input: { companyId: string; title: string; department: string; summary: string; sections: JobSections; showSalary: boolean }) {
  const co = await loadCompany(env, input.companyId);
  return runAi(env, {
    task: 'jd.review', userId, effort: 'medium', schema: ReviewResult,
    system: [HOUSE_RULES, JD_FORMAT, companyBlock(co.name, co.profile)],
    user: `Review this job description against the house rules. Score each dimension 1–5 and give an overall 0–100. List line-level suggestions the recruiter can accept one at a time (quote the original line exactly). Flag missing information (salary visibility: ${input.showSalary ? 'shown' : 'not shown'}, shift, location, interview steps) and any offer line that is not in the company profile as a compliance issue.\n\n<jd title="${input.title}" department="${input.department}">\n${JSON.stringify({ summary: input.summary, ...input.sections })}\n</jd>`,
    mock: () => mockReview(input, co),
  });
}

// ---------- Channel copy ----------

export async function channelCopy(env: Env, userId: string, input: { jobId: string; provider: string }) {
  const d = db(env);
  const row = await d.select({ j: schema.jobs, c: schema.companies, v: schema.jobVersions })
    .from(schema.jobs)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.jobs.companyId))
    .innerJoin(schema.jobVersions, and(eq(schema.jobVersions.jobId, schema.jobs.id), eq(schema.jobVersions.version, schema.jobs.currentVersion)))
    .where(eq(schema.jobs.id, input.jobId)).get();
  if (!row) bad('Job not found', 404);
  const guide = CHANNEL_GUIDES[input.provider] ?? CHANNEL_GUIDES.mock!;
  return runAi(env, {
    task: `copy.${input.provider}`, userId, effort: 'low', schema: ChannelCopy, maxTokens: 8000,
    system: [HOUSE_RULES, companyBlock(row.c.name, row.c.profile)],
    user: `Write two different variants of channel copy for this job.\nChannel: ${guide}\nAlways include the requisition ID ${row.j.id} and the line "We never charge a fee at any stage of hiring." Use {{link}} exactly as the link placeholder.\n\n<job>\n${JSON.stringify({ title: row.j.title, company: row.c.name, department: row.j.department, location: row.j.location, mode: row.j.workMode, shift: row.j.shift, experience: row.j.expLabel, seats: row.j.seats, incentive: row.j.incentive, summary: row.j.summary, ...row.v.sections })}\n</job>`,
    mock: () => mockCopy(row.j, row.c.name, input.provider),
  });
}

// ---------- Deterministic mocks (dev/test without an API key) ----------

function mockDraft(co: Company, brief: string, department?: string): JdDraft {
  const b = sentence(brief);
  const seats = Number(/(\d+)\s*(?:seats|people|positions|roles|x\b|executives|associates|hires)/i.exec(b)?.[1] ?? /need\s+(\d+)/i.exec(b)?.[1] ?? 1);
  const titleMatch = /(?:need|hiring|hire|for)\s+(?:\d+\s+)?(?:an?\s+)?([A-Z][\w&/ -]{3,60}?)(?:s\b|,|\.|$)/.exec(b);
  const title = titleMatch?.[1]?.trim() ?? 'New role';
  const shift = /us shift|night/i.test(b) ? 'US shift' : /uk shift/i.test(b) ? 'UK shift' : 'Day shift';
  const fresher = /fresher|graduate|entry/i.test(b);
  const loc = co.profile.locations.find((l) => b.toLowerCase().includes(l.toLowerCase())) ?? co.profile.locations[0] ?? 'Bengaluru';
  const dept = department ?? (/lead gen|lge/i.test(b) ? 'Lead Generation' : /sales|bd/i.test(b) ? 'Sales' : 'Operations');
  return {
    title, department: dept, location: loc, workMode: /hybrid/i.test(b) ? 'Hybrid' : /remote/i.test(b) ? 'Remote' : 'Onsite', shift,
    expLabel: fresher ? '0–2 yrs' : '2–5 yrs', expBand: fresher ? 0 : 1, seats, incentive: /incentive|target|sales|lead/i.test(b),
    summary: `[Mock AI] ${title} at ${co.name}, ${loc}. Drafted from the brief so you can try the flow without an API key.`,
    sections: {
      opportunity: `We're hiring ${seats > 1 ? `${seats} people` : 'one person'} as ${title} at ${co.name}, based in ${loc} (${shift}).`,
      responsibilities: ['Research 40 target accounts a day using our data tools and log them in the CRM', 'Run 3-step email and LinkedIn sequences to new contacts every day', 'Qualify replies against the ideal customer profile and book first meetings', 'Review your reply and meeting rates every Friday with your team lead'],
      mustHave: [fresher ? 'Graduate in any discipline; freshers welcome' : '2+ years in a similar role', 'Clear written and spoken English', `Comfortable working ${shift}`],
      niceToHave: ['Experience with a CRM such as HubSpot or Salesforce', 'Some exposure to B2B buyers in the US or UK'],
      whatWeLookFor: ['People who enjoy a target, learn fast and follow through.'],
      first90Days: [{ by: '30', outcome: 'Complete product and CRM training', measure: 'Certification passed' }, { by: '60', outcome: 'Run your own sequences on a ramped target', measure: 'Ramp target met' }, { by: '90', outcome: 'Work to full target', measure: 'Full target met' }],
      offers: co.profile.offers,
      skills: ['research', 'email outreach', 'CRM', 'LinkedIn'],
      assessment: 'A 10-minute mock cold call with a recruiter playing the buyer.',
    },
    openQuestions: ['Salary range and whether to show it publicly', 'Confirm the daily activity targets above', 'Interview rounds for this role'],
  };
}

function mockTaskify(input: { sections: JobSections }): TaskifyResult {
  const vague = input.sections.responsibilities.filter((r) => !/\d/.test(r)).slice(0, 4);
  return {
    rewrites: vague.map((r) => ({ section: 'responsibilities' as const, original: r, rewritten: `${r.replace(/\.$/, '')}, with a weekly target agreed with your lead (e.g. 40 a day)`, why: '[Mock AI] Adds a volume so candidates can picture the day.' })),
    first90Days: [{ by: '30', outcome: 'Complete onboarding and shadow the team', measure: 'Training checklist complete' }, { by: '60', outcome: 'Own your workload on a ramped target', measure: '70% of target' }, { by: '90', outcome: 'Work to full target', measure: '100% of target' }],
    assessment: 'A short practical task based on a real day in the role, reviewed with the hiring manager.',
    openQuestions: ['Confirm the example volumes with the hiring manager'],
  };
}

function mockReview(input: { sections: JobSections; summary: string; showSalary: boolean }, co: Company): ReviewResult {
  const vague = input.sections.responsibilities.filter((r) => !/\d/.test(r));
  const offList = input.sections.offers.filter((o) => !co.profile.offers.includes(o) && !/pay/i.test(o));
  return {
    scores: { clarity: 4, specificity: vague.length > 2 ? 2 : 4, completeness: input.showSalary ? 4 : 3, inclusiveLanguage: 5, length: 4 },
    overall: vague.length > 2 ? 68 : 84,
    verdict: '[Mock AI] Clear and well structured; responsibilities would be stronger with volumes and outcomes.',
    suggestions: vague.slice(0, 3).map((r) => ({ section: 'responsibilities', original: r, suggestion: `${r.replace(/\.$/, '')} (state a daily or weekly volume)`, reason: 'Concrete volumes help candidates self-select.', kind: 'specificity' as const })),
    missing: [...(input.showSalary ? [] : ['Salary range is not shown']), 'Interview steps are not described', ...offList.map((o) => `Offer line not in the company profile: "${o}"`)],
  };
}

function mockCopy(j: typeof schema.jobs.$inferSelect, company: string, provider: string): ChannelCopy {
  const tags = provider.startsWith('linkedin') ? ['hiring', 'careers', j.department.replace(/\W/g, ''), j.location.split(' ')[0]!.replace(/\W/g, '')] : [];
  const voice = provider === 'linkedin_member' ? `I'm hiring` : `${company} is hiring`;
  return {
    variants: [
      { text: `${voice}: ${j.seats > 1 ? `${j.seats} × ` : ''}${j.title} in ${j.location} (${j.workMode}, ${j.shift}).\n\n${j.summary}\n\n• ${j.expLabel} experience\n• ${j.incentive ? 'Fixed pay + incentive' : 'Competitive pay'}\n\nReq ID ${j.id}. We never charge a fee at any stage of hiring.\n{{link}}`, hashtags: tags },
      { text: `Looking for your next move in ${j.department}? ${company} needs a ${j.title} in ${j.location}.\n\n${j.summary}\n\nReq ID ${j.id}. We never charge a fee at any stage of hiring.\nApply: {{link}}`, hashtags: tags },
    ],
  };
}
