import { test, expect, Route } from '@playwright/test';
import { MINIMAL_ISC_YAML } from '../helpers/minimalConfig.js';

// Source registry TLS is verified unless the user opts out for one operation.

test.describe('Start Operation - source TLS verification', () => {
  const createdConfigs: string[] = [];

  test.afterAll(async ({ request }) => {
    for (const name of createdConfigs) {
      await request.delete(`/api/config/delete/${name}`).catch(() => {});
    }
  });

  async function startWithCapturedFlags(page: import('@playwright/test').Page, skipTls: boolean) {
    const configName = `e2e-tls-${skipTls ? 'skip' : 'default'}-${Date.now()}.yaml`;
    createdConfigs.push(configName);
    const saveRes = await page.request.post('/api/config/save', {
      data: { config: MINIMAL_ISC_YAML, name: configName },
    });
    expect(saveRes.ok()).toBeTruthy();

    let sentBody: Record<string, unknown> | null = null;
    await page.route('**/api/operations/start', (route: Route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      sentBody = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Operation started successfully', operationId: 'e2e-tls-op' }),
      });
    });

    await page.goto('/operations');
    await expect(page.getByRole('heading', { name: 'Start New Operation' })).toBeVisible({ timeout: 15000 });
    const configToggle = page.getByLabel('Select ImageSetConfiguration file');
    await configToggle.click();
    await page.getByRole('option', { name: new RegExp(configName) }).click();

    await page.getByRole('button', { name: /Advanced Options/i }).click();
    const tlsSwitch = page.getByLabel('Skip TLS verification for source registries');
    await expect(tlsSwitch).toBeVisible();
    await expect(tlsSwitch).not.toBeChecked();
    if (skipTls) {
      await page.locator('#flag-skip-source-tls-verify').click({ force: true });
      await expect(tlsSwitch).toBeChecked();
    }

    await page.getByRole('button', { name: 'Start Operation' }).click();
    await expect.poll(() => sentBody, { timeout: 10000 }).not.toBeNull();
    return sentBody as unknown as { optionalFlags?: Record<string, unknown> };
  }

  test('switch is off by default and the request does not skip TLS', async ({ page }) => {
    const body = await startWithCapturedFlags(page, false);
    expect(body.optionalFlags?.skipSourceTlsVerify).toBeUndefined();
  });

  test('turning the switch on sends skipSourceTlsVerify', async ({ page }) => {
    const body = await startWithCapturedFlags(page, true);
    expect(body.optionalFlags?.skipSourceTlsVerify).toBe(true);
  });

  test('the info popover warns against skipping TLS', async ({ page }) => {
    await page.goto('/operations');
    await page.getByRole('button', { name: /Advanced Options/i }).click();
    await page.getByLabel('More info about skipping TLS verification').click();
    await expect(page.getByText(/Not recommended/)).toBeVisible();
  });
});
