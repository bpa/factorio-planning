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

test('named malls retain goals and inputs across profile and mall switches', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Crafting', exact: true }).click();

  await page.getByLabel('Create mall').fill('Science');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByLabel('Active mall')).toHaveValue(/.+/);
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Science');
  await page.getByLabel('Name', { exact: true }).fill('Science mall');
  await page.getByRole('button', { name: 'Save name' }).click();
  await page.getByLabel('Status', { exact: true }).selectOption('completed');
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('completed');
  await page.getByLabel('Status', { exact: true }).selectOption('planned');

  await page.getByRole('searchbox', { name: 'Search items' }).fill('iron plate');
  await page.getByRole('button', { name: 'Add Iron plate goal' }).click();
  const targetRate = page.getByRole('spinbutton', { name: 'Iron plate target per minute' });
  await expect(targetRate).toHaveValue('1');
  await targetRate.fill('120');
  await page.getByRole('button', { name: 'Add Iron plate input' }).click();
  const mallWorkspace = page.getByRole('region', { name: 'Mall planning' });
  await expect(mallWorkspace.getByRole('heading', { name: 'Goals', exact: true })).toBeVisible();
  await expect(mallWorkspace.getByRole('button', { name: 'Remove Iron plate input' })).toBeVisible();
  const suggestionButton = mallWorkspace.getByRole('button', { name: /^Add .* goal$/ }).first();
  const suggestedGoalLabel = await suggestionButton.getAttribute('aria-label');
  const suggestedGoalName = suggestedGoalLabel.match(/^Add (.*) goal$/)[1];
  await suggestionButton.click();
  await expect(mallWorkspace.getByRole('button', { name: `Remove ${suggestedGoalName} goal` })).toBeVisible();
  await mallWorkspace.getByRole('button', { name: `Remove ${suggestedGoalName} goal` }).click();

  await page.getByRole('button', { name: 'Manage Profiles' }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Compact');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const profileSelect = page.getByLabel('Profile', { exact: true });
  await expect(profileSelect).toHaveValue(/.+/);
  await profileSelect.selectOption('none');
  await profileSelect.selectOption({ label: 'Compact' });

  await page.getByLabel('Create mall').fill('Other');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Other');
  await profileSelect.selectOption('none');
  await page.getByLabel('Active mall').selectOption({ label: 'Science mall' });
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Science mall');
  await expect(page.getByRole('spinbutton', { name: 'Iron plate target per minute' })).toHaveValue('120');
  await expect(mallWorkspace.getByRole('button', { name: 'Remove Iron plate input' })).toBeVisible();
  await expect(profileSelect).toHaveValue(/.+/);
});