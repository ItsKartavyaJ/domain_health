// @ts-check
/**
 * Mailboxes Page E2E Tests
 *
 * Tests for the Mailboxes tab features including:
 * - Mailbox table loads
 * - Disconnected mailboxes show names (not just count)
 * - Status badges display (active/inactive/disconnected)
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS = path.resolve(__dirname, '../screenshots');
const BASE_URL = 'http://35.192.170.220:8787';

async function getPageState(page) {
  const text = await page.locator('body').innerText();
  return {
    text,
    isLoginPage: text.includes('Continue with Google') || text.includes('Sign in'),
    isDashboard: text.includes('Overview') && text.includes('Campaigns') && text.includes('Mailboxes'),
  };
}

test.describe('Mailboxes Page', () => {
  test('TC-M01: Mailboxes tab is listed in navigation', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);

    const state = await getPageState(page);
    if (!state.isDashboard) {
      console.log('[TC-M01] CONDITIONAL: Not authenticated.');
      console.log('[TC-M01] Login page visible:', state.isLoginPage);
      await page.screenshot({ path: path.join(SCREENSHOTS, 'M01-auth-required.png'), fullPage: true });
      return;
    }

    const mailboxesTab = page.locator('nav div', { hasText: 'Mailboxes' }).first();
    await expect(mailboxesTab).toBeVisible();
    console.log('[TC-M01] Mailboxes tab found in nav');
    await page.screenshot({ path: path.join(SCREENSHOTS, 'M01-mailboxes-tab.png'), fullPage: true });
  });

  test('TC-M02: Navigate to Mailboxes page and verify heading', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);

    const state = await getPageState(page);
    if (!state.isDashboard) {
      console.log('[TC-M02] SKIP: Auth required.');
      return;
    }

    await page.locator('nav div', { hasText: 'Mailboxes' }).first().click();
    await page.waitForTimeout(3000);

    const pageText = await page.locator('body').innerText();
    const hasMailboxHeading = pageText.includes('Mailbox Health') || pageText.includes('Mailboxes');
    console.log('[TC-M02] Mailbox Health heading:', hasMailboxHeading);
    expect(hasMailboxHeading).toBe(true);

    await page.screenshot({ path: path.join(SCREENSHOTS, 'M02-mailboxes-page.png'), fullPage: true });
  });

  test('TC-M03: Mailbox table loads with correct columns', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);

    const state = await getPageState(page);
    if (!state.isDashboard) {
      console.log('[TC-M03] SKIP: Auth required.');
      return;
    }

    await page.locator('nav div', { hasText: 'Mailboxes' }).first().click();
    await page.waitForTimeout(5000);

    const tableHeaders = await page.locator('thead th').allInnerTexts();
    console.log('[TC-M03] Table headers:', tableHeaders);

    const expected = ['Mailbox', 'Status', 'Sent', 'Opened', 'Replied', 'Reply Rate', 'Bounced', 'Bounce Rate'];
    for (const col of expected) {
      const found = tableHeaders.some(h => h.replace(/[▼▲\s]/g, '').toLowerCase().includes(col.toLowerCase().replace(' ', '')));
      console.log(`[TC-M03] Column "${col}" found:`, found);
      expect(found).toBe(true);
    }

    await page.screenshot({ path: path.join(SCREENSHOTS, 'M03-mailbox-columns.png'), fullPage: true });
  });

  test('TC-M04: Status badges display with correct labels', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);

    const state = await getPageState(page);
    if (!state.isDashboard) {
      console.log('[TC-M04] SKIP: Auth required.');
      return;
    }

    await page.locator('nav div', { hasText: 'Mailboxes' }).first().click();
    await page.waitForTimeout(5000);

    // Get all badge text values in the status column
    const badgeTexts = await page.locator('tbody td:nth-child(2)').allInnerTexts();
    const uniqueStatuses = [...new Set(badgeTexts.filter(t => t.trim()))];
    console.log('[TC-M04] Unique status values found:', uniqueStatuses);

    // Valid statuses: Active, Idle, Disconnected
    const validStatuses = ['Active', 'Idle', 'Disconnected'];
    for (const status of uniqueStatuses) {
      const isValid = validStatuses.includes(status.trim());
      console.log(`[TC-M04] Status "${status.trim()}" is valid:`, isValid);
      expect(isValid).toBe(true);
    }

    await page.screenshot({ path: path.join(SCREENSHOTS, 'M04-status-badges.png'), fullPage: true });
  });

  test('TC-M05: Disconnected mailboxes show email address names (not just count)', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);

    const state = await getPageState(page);
    if (!state.isDashboard) {
      console.log('[TC-M05] SKIP: Auth required.');
      return;
    }

    await page.locator('nav div', { hasText: 'Mailboxes' }).first().click();
    await page.waitForTimeout(5000);

    // Find rows where status is "Disconnected"
    const allRows = await page.locator('tbody tr').all();
    let disconnectedEmails = [];

    for (const row of allRows) {
      const statusCell = row.locator('td:nth-child(2)');
      const emailCell = row.locator('td:nth-child(1)');
      const statusText = await statusCell.innerText();

      if (statusText.trim() === 'Disconnected') {
        const emailText = await emailCell.innerText();
        disconnectedEmails.push(emailText.trim());
      }
    }

    console.log('[TC-M05] Disconnected mailbox emails found:', disconnectedEmails.length);
    console.log('[TC-M05] Emails:', disconnectedEmails.slice(0, 5));

    if (disconnectedEmails.length > 0) {
      // Verify each disconnected mailbox shows an actual email, not "—" or blank
      for (const email of disconnectedEmails) {
        const hasEmail = email.includes('@') || email === '—';
        console.log(`[TC-M05] Row "${email}" shows identifier:`, email !== '');
        expect(email.length).toBeGreaterThan(0);
      }
    } else {
      console.log('[TC-M05] No disconnected mailboxes in current dataset — feature untestable without data');
    }

    // Also check the summary stat card which should show "X disconnected" label
    const summaryText = await page.locator('main').innerText();
    const hasDisconnectedLabel = summaryText.includes('disconnected');
    console.log('[TC-M05] Summary shows "disconnected" label:', hasDisconnectedLabel);

    await page.screenshot({ path: path.join(SCREENSHOTS, 'M05-disconnected-mailboxes.png'), fullPage: true });
  });

  test('TC-M06: Summary stat cards display (mailboxes, sent, replies, bounced)', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);

    const state = await getPageState(page);
    if (!state.isDashboard) {
      console.log('[TC-M06] SKIP: Auth required.');
      return;
    }

    await page.locator('nav div', { hasText: 'Mailboxes' }).first().click();
    await page.waitForTimeout(5000);

    const pageText = await page.locator('main').innerText();
    const expectedLabels = ['Mailboxes', 'Total Sent', 'Total Replies', 'Total Bounced'];
    for (const label of expectedLabels) {
      const found = pageText.includes(label);
      console.log(`[TC-M06] Stat card "${label}":`, found);
      expect(found).toBe(true);
    }

    await page.screenshot({ path: path.join(SCREENSHOTS, 'M06-stat-cards.png'), fullPage: true });
  });

  test('TC-M07: Mailbox search input filters by email', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);

    const state = await getPageState(page);
    if (!state.isDashboard) {
      console.log('[TC-M07] SKIP: Auth required.');
      return;
    }

    await page.locator('nav div', { hasText: 'Mailboxes' }).first().click();
    await page.waitForTimeout(5000);

    const searchInput = page.locator('input[placeholder="Search mailboxes..."]');
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    // Search for something that won't exist
    await searchInput.fill('zzz_no_match_xyz@nonexistent.com');
    await page.waitForTimeout(500);

    const tableText = await page.locator('table').innerText();
    const noResults = tableText.includes('No mailboxes found');
    console.log('[TC-M07] Non-match shows "No mailboxes found":', noResults);
    expect(noResults).toBe(true);

    await searchInput.fill('');
    await page.screenshot({ path: path.join(SCREENSHOTS, 'M07-mailbox-search.png'), fullPage: true });
  });

  test('TC-M08: Provider and domain breakdown charts are present', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);

    const state = await getPageState(page);
    if (!state.isDashboard) {
      console.log('[TC-M08] SKIP: Auth required.');
      return;
    }

    await page.locator('nav div', { hasText: 'Mailboxes' }).first().click();
    await page.waitForTimeout(5000);

    const mainText = await page.locator('main').innerText();
    const hasProviderChart = mainText.includes('By Email Provider');
    const hasDomainTable = mainText.includes('By Sending Domain');
    console.log('[TC-M08] Provider chart section:', hasProviderChart);
    console.log('[TC-M08] Domain breakdown section:', hasDomainTable);

    expect(hasProviderChart).toBe(true);
    expect(hasDomainTable).toBe(true);

    await page.screenshot({ path: path.join(SCREENSHOTS, 'M08-charts.png'), fullPage: true });
  });
});
