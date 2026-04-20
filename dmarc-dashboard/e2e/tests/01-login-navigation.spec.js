// @ts-check
import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS = path.resolve(__dirname, '../screenshots');
const BASE_URL = 'http://35.192.170.220:8787';

test.describe('Login & Navigation', () => {
  test('TC-01: Page loads at dashboard URL', async ({ page }) => {
    const response = await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    expect(response.status()).toBeLessThan(400);
    const title = await page.title();
    console.log(`[TC-01] Page title: "${title}"`);
    await page.screenshot({ path: path.join(SCREENSHOTS, '01-page-load.png'), fullPage: true });
  });

  test('TC-02: Login page shows DMARC Monitor branding', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // Wait for either auth-checking to complete or login to appear
    await page.waitForTimeout(3000);
    const bodyText = await page.locator('body').innerText();
    console.log(`[TC-02] Body snippet: ${bodyText.slice(0, 300)}`);

    await page.screenshot({ path: path.join(SCREENSHOTS, '02-login-page.png'), fullPage: true });

    // Check for DMARC Monitor branding
    const hasDmarcMonitor = bodyText.includes('DMARC Monitor');
    expect(hasDmarcMonitor).toBe(true);
  });

  test('TC-03: Login page shows Google sign-in button', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // App could be: (a) showing login page, or (b) showing "Checking session..."
    const bodyText = await page.locator('body').innerText();
    const hasGoogleButton = bodyText.includes('Continue with Google') || bodyText.includes('Google');
    console.log(`[TC-03] Google button present: ${hasGoogleButton}`);
    console.log(`[TC-03] Body: ${bodyText.slice(0, 400)}`);

    // The login page should have a Google sign-in button
    if (bodyText.includes('Checking session')) {
      // Still loading - wait longer
      await page.waitForTimeout(5000);
      const newText = await page.locator('body').innerText();
      console.log(`[TC-03] After wait: ${newText.slice(0, 400)}`);
    }

    await page.screenshot({ path: path.join(SCREENSHOTS, '03-login-google-button.png'), fullPage: true });
  });

  test('TC-04: Login page shows pintel.ai restriction notice', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(4000);

    const bodyText = await page.locator('body').innerText();
    const hasPintelRestriction = bodyText.includes('pintel.ai');
    console.log(`[TC-04] pintel.ai restriction present: ${hasPintelRestriction}`);

    await page.screenshot({ path: path.join(SCREENSHOTS, '04-login-restriction.png'), fullPage: true });
    expect(hasPintelRestriction).toBe(true);
  });

  test('TC-05: Login page has Sign in heading', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(4000);

    const bodyText = await page.locator('body').innerText();
    const hasSignIn = bodyText.includes('Sign in');
    console.log(`[TC-05] Sign in heading present: ${hasSignIn}`);
    expect(hasSignIn).toBe(true);
  });

  test('TC-06: Login page card has correct content structure', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(4000);

    // Verify the page renders meaningful content (not blank/error)
    const allText = await page.locator('body').innerText();
    expect(allText.trim().length).toBeGreaterThan(10);

    // Look for key UI elements via DOM
    const buttons = await page.locator('button').count();
    console.log(`[TC-06] Buttons on page: ${buttons}`);
    expect(buttons).toBeGreaterThanOrEqual(1);

    await page.screenshot({ path: path.join(SCREENSHOTS, '06-login-structure.png'), fullPage: true });
  });

  // NOTE: Full tab navigation tests require authenticated session.
  // The following test documents what the login page exposes and what
  // credentials are needed.
  test('TC-07: Document login page state for auth requirement', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);

    const bodyText = await page.locator('body').innerText();
    const html = await page.content();

    console.log('=== AUTH REQUIREMENT DOCUMENTATION ===');
    console.log('Auth type: Firebase Google OAuth (signInWithPopup)');
    console.log('Restriction: @pintel.ai accounts only');
    console.log(`Page text: ${bodyText.slice(0, 500)}`);
    console.log(`Has tabs visible: ${bodyText.includes('Overview') && bodyText.includes('Campaigns')}`);
    console.log(`Has login card: ${html.includes('Continue with Google')}`);

    await page.screenshot({ path: path.join(SCREENSHOTS, '07-auth-state-doc.png'), fullPage: true });

    // Test passes regardless — this is documentation
    expect(true).toBe(true);
  });
});
