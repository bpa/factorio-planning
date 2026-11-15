import { expect, test } from '@playwright/test';

test('the current app opens and switches planner views and datasets', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Technology costs' })).toBeVisible();

  await page.getByRole('button', { name: 'Crafting', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Crafting planner' })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search items' })).toBeVisible();

  const spaceAge = page.getByRole('button', { name: 'Space Age' });
  await spaceAge.click();
  await expect(spaceAge).toHaveAttribute('aria-pressed', 'true');
});