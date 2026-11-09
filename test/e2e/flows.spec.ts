import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const shots = process.env.SHOTS_DIR;
const snap = async (page: import('@playwright/test').Page, name: string) => {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`), fullPage: false });
};

test('candidate: search, open a job, apply to two roles, see them in My applications', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#sbRoles')).not.toHaveText('0');
  await snap(page, '01-careers-home');

  await page.fill('#q', '"lead generation"');
  await expect(page.locator('#resCount')).toHaveText(/^[1-9]/);
  await page.locator('#jobList .save').first().click(); // save one role for multi-apply
  await page.locator('#jobList h3 a').first().click();
  await expect(page.locator('.jp-head h1')).toBeVisible();
  await snap(page, '02-job-page');

  await page.locator('.jp-head [data-apply]').click();
  await expect(page.locator('#modal')).toContainText('Choose roles');
  await page.click('#mNext');
  const email = `e2e.${Date.now()}@example.com`;
  await page.fill('#aName', 'E2E Candidate');
  await page.fill('#aEmail', email);
  await page.fill('#aPhone', '+91 98450 11111');
  await page.fill('#aExp', '2');
  const cv = join(tmpdir(), 'e2e-cv.pdf');
  writeFileSync(cv, '%PDF-1.4\n%%EOF');
  await page.setInputFiles('#aCv', { name: 'cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
  await expect(page.locator('#aCvState')).toContainText('Attached');
  await page.click('#mNext');
  await page.fill('#aWin', 'Booked 42 meetings in a quarter');
  await page.click('#mNext');
  await page.check('#aProc');
  await snap(page, '03-apply-consent');
  await page.click('#mNext');
  await expect(page.locator('#modal')).toContainText('Application received');
  await page.click('#toApps');
  await expect(page.locator('#meName')).toHaveText('E2E Candidate');
  await expect(page.locator('#appList .app')).toHaveCount(1);
  await snap(page, '04-my-applications');
  expect(errors).toEqual([]);
});

test('recruiter: draft with AI, save, publish to careers site + mock board, then see it live', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/console#/dashboard');
  await expect(page.locator('.kpi').first()).toBeVisible();
  await snap(page, '05-console-dashboard');

  await page.goto('/console#/jobs/new');
  await page.fill('#brief', 'Need 6 Data Research Analysts for Champion InfoMetrics, day shift, Bengaluru, freshers OK');
  await page.click('#aiDraft');
  await expect(page.locator('#aiOut')).toContainText('Draft filled in');
  await page.fill('#fTitle', `Data Research Analyst E2E ${Date.now() % 10000}`);
  await page.fill('#fSum', 'Verify and enrich the B2B data our clients run their campaigns on.');
  await page.click('#aiReview');
  await expect(page.locator('#aiOut')).toContainText('/100');
  await snap(page, '06-jd-studio');
  await page.click('#bSave');
  await expect(page).toHaveURL(/#\/jobs\/CG-/);
  const id = decodeURIComponent(page.url().split('#/jobs/')[1]!);

  await page.goto(`/console#/jobs/${encodeURIComponent(id)}/distribute`);
  await expect(page.locator('#chanList .chan').first()).toBeVisible();
  const mock = page.locator('.chan[data-provider="mock"]');
  await mock.locator('input[type=checkbox]').check();
  await mock.locator('[data-gen]').click();
  await expect(mock.locator('textarea')).not.toHaveValue('');
  await snap(page, '07-distribute');
  await page.click('#bPublish');
  await expect(page.locator('#postRows')).toContainText('live', { timeout: 15_000 });
  await snap(page, '08-posted');

  await page.goto('/');
  await page.fill('#q', id);
  await expect(page.locator('#resCount')).toHaveText('1');
  expect(errors).toEqual([]);
});
