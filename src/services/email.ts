import type { Env } from '../env';

export type Email = { to: string; subject: string; text: string; html?: string; tag?: string };

/**
 * Transactional email behind one function. Uses Resend when RESEND_API_KEY is set,
 * otherwise logs (local dev / tests). Never throws: email failure must not fail the request.
 */
export async function sendEmail(env: Env & { RESEND_API_KEY?: string; EMAIL_FROM?: string }, mail: Email): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.log(`[email:${mail.tag ?? 'mail'}] to=${mail.to} subject="${mail.subject}"\n${mail.text}`);
    return true;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM ?? 'Champions Group Careers <careers@championsgroup.com>', to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
    });
    if (!res.ok) console.warn('[email] provider error', res.status, await res.text());
    return res.ok;
  } catch (err) {
    console.warn('[email] failed', (err as Error).message);
    return false;
  }
}
