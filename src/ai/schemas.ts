import { z } from 'zod';

/** Shapes Claude must return. Kept free of min/max constraints so structured outputs accept them; we validate counts in code. */

export const Ninety = z.object({ by: z.enum(['30', '60', '90']), outcome: z.string(), measure: z.string() });

export const JdSections = z.object({
  opportunity: z.string().describe('2–3 sentences: the team, the seat count, where and how they work'),
  responsibilities: z.array(z.string()).describe('4–8 concrete tasks, each with a volume, tool or outcome where the brief allows'),
  mustHave: z.array(z.string()),
  niceToHave: z.array(z.string()),
  whatWeLookFor: z.array(z.string()).describe('1–2 short paragraphs on attitude and working style'),
  first90Days: z.array(Ninety).describe('Exactly three entries: by 30, 60 and 90 days, each with a measurable check'),
  offers: z.array(z.string()).describe('ONLY lines taken from the company profile offers list'),
  skills: z.array(z.string()).describe('4–8 short skill tags'),
  assessment: z.string().describe('One role-specific assessment task'),
});

export const JdDraft = z.object({
  title: z.string(),
  department: z.string(),
  location: z.string(),
  workMode: z.enum(['Onsite', 'Hybrid', 'Remote']),
  shift: z.string(),
  expLabel: z.string().describe('e.g. "0–2 yrs", "4–7 yrs", "15+ yrs"'),
  expBand: z.number().int().describe('0 = 0–2 yrs, 1 = 2–5, 2 = 5–10, 3 = 10+'),
  seats: z.number().int(),
  incentive: z.boolean(),
  summary: z.string().describe('One sentence for the job card, under 180 characters'),
  sections: JdSections,
  openQuestions: z.array(z.string()).describe('Facts the recruiter must confirm because the brief and company profile do not state them'),
});
export type JdDraft = z.infer<typeof JdDraft>;

export const TaskifyResult = z.object({
  rewrites: z.array(z.object({ section: z.enum(['responsibilities', 'mustHave', 'niceToHave']), original: z.string(), rewritten: z.string(), why: z.string() })),
  first90Days: z.array(Ninety),
  assessment: z.string(),
  openQuestions: z.array(z.string()),
});
export type TaskifyResult = z.infer<typeof TaskifyResult>;

export const ReviewResult = z.object({
  scores: z.object({
    clarity: z.number().int().describe('1–5'),
    specificity: z.number().int().describe('1–5'),
    completeness: z.number().int().describe('1–5'),
    inclusiveLanguage: z.number().int().describe('1–5'),
    length: z.number().int().describe('1–5'),
  }),
  overall: z.number().int().describe('0–100'),
  verdict: z.string().describe('One sentence'),
  suggestions: z.array(z.object({
    section: z.string(),
    original: z.string(),
    suggestion: z.string(),
    reason: z.string(),
    kind: z.enum(['specificity', 'clarity', 'inclusive-language', 'missing-info', 'compliance', 'length']),
  })),
  missing: z.array(z.string()),
});
export type ReviewResult = z.infer<typeof ReviewResult>;

export const ChannelCopy = z.object({
  variants: z.array(z.object({ text: z.string(), hashtags: z.array(z.string()) })).describe('Exactly two variants'),
});
export type ChannelCopy = z.infer<typeof ChannelCopy>;
