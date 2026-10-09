import { test, expect, Route } from '@playwright/test';

// The UI adds what GET /api/operators/:operator/dependencies returns: transitive dependencies
// with their real default channels, and shows required APIs it could not resolve as a warning.

test.describe('Mirror Configuration - dependency detection', () => {
  test('adds transitive dependencies with real channels and warns about unresolved APIs', async ({ page }) => {
    const depRequests: string[] = [];
    await page.route('**/api/operators/odf-operator/dependencies*', (route: Route) => {
      depRequests.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          operator: 'odf-operator',
          channel: 'stable-4.21',
          resolution: 'graph',
          dependencies: [
            { packageName: 'mcg-operator', reason: 'package', requiredBy: 'odf-operator', defaultChannel: 'stable-4.21' },
            { packageName: 'e2e-api-provider', reason: 'api', api: 'example.com/v1/Widget', requiredBy: 'mcg-operator' },
          ],
          unresolvedApis: [
            { api: 'monitoring.coreos.com/v1/ServiceMonitor', candidates: [], requiredBy: 'odf-operator' },
          ],
          count: 2,
        }),
      });
    });

    await page.goto('/config');
    await page.getByRole('tab', { name: /Operators/ }).click();
    await page.getByRole('button', { name: 'Add operator catalog' }).click();
    await expect(page.getByRole('button', { name: /redhat-operator-index/ })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Add operator', exact: true }).click();
    const operatorInput = page.getByPlaceholder('Type to search operators...');
    await operatorInput.fill('odf');
    await page.getByRole('option', { name: 'odf-operator' }).click();

    await expect(page.getByText('Auto-added 2 dependency package(s) for odf-operator')).toBeVisible({ timeout: 10_000 });
    const warning = page.locator('.pf-v6-c-alert.pf-m-warning');
    await expect(warning).toContainText('monitoring.coreos.com/v1/ServiceMonitor');
    await expect(warning).toContainText('no package in this catalog provides it');

    expect(depRequests[0]).toContain('catalogUrl=');

    await page.getByRole('tab', { name: /Preview/ }).click();
    const yaml = (await page.locator('#yaml-preview').textContent()) ?? '';
    expect(yaml).toContain('mcg-operator');
    expect(yaml).toContain('stable-4.21');
    // no guessed channel: a dependency without a known default channel has no channel filter
    const providerBlock = yaml.slice(yaml.indexOf('e2e-api-provider'));
    expect(providerBlock.split('\n').slice(0, 3).join('\n')).not.toMatch(/channels:/);
  });
});
