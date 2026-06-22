import { test, expect } from './fixtures/test';
import { signIn, uniqueEmail } from './helpers/auth';
import { getAisles, getCanonItem, seedCanonItem } from './helpers/seed';
import { aislesPage } from './helpers/locators';
import { keyboardReorder } from './helpers/dnd';
import { SYNC_TIMEOUT } from './helpers/timeouts';

test('add, reorder, and bulk-delete aisles unassigns referencing canon items', async ({
  page,
}, testInfo) => {
  const email = uniqueEmail(testInfo.testId);
  const ui = aislesPage(page);

  await page.goto('/');
  await signIn(page, email, { admin: true });

  await page.goto('/#/admin/aisles');
  await expect(ui.heading).toBeVisible();

  await ui.addButton.click();
  await expect(ui.addDialog).toBeVisible();
  await ui.addTextarea.fill('Produce\nDairy\nBakery');
  await ui.addSubmit.click();
  await expect(ui.addDialog).toBeHidden();

  await expect(page.getByText('Produce', { exact: true })).toBeVisible();
  await expect(page.getByText('Dairy', { exact: true })).toBeVisible();
  await expect(page.getByText('Bakery', { exact: true })).toBeVisible();

  const aisles = await getAisles(page);
  const bakery = aisles.find((a) => a.name === 'Bakery');
  // eslint-disable-next-line playwright/no-conditional-in-test -- setup precondition + type-narrow, not branching test logic
  if (!bakery) throw new Error('Bakery aisle not found after add');

  const seededItem = await seedCanonItem(page, {
    name: 'Sourdough loaf',
    aisleId: bakery.id,
  });

  // Order before reorder: Produce, Dairy, Bakery (insertion order from bulk add).
  // Move Bakery up one slot → Produce, Bakery, Dairy.
  await keyboardReorder(page, bakery.id, 'up', 1);

  await expect
    .poll(async () => (await getAisles(page)).map((a) => a.name))
    .toEqual(['Produce', 'Bakery', 'Dairy']);

  await page.getByRole('button', { name: /^select$/i }).click();
  await ui.rowCheckbox(bakery.id).click();
  await ui.bulkDeleteButton.click();
  await expect(ui.bulkDeleteDialog).toBeVisible();
  await expect(ui.bulkDeleteDialog.getByText('Sourdough Loaf', { exact: true })).toBeVisible();

  await ui.bulkDeleteConfirm.click();
  await expect(ui.bulkDeleteDialog).toBeHidden();
  await expect(page.getByText('Bakery', { exact: true })).toBeHidden();

  // Deleting the Bakery aisle unassigns referencing canon items (aisleId → null,
  // needs_approval → true) as a follow-on write that can lag the row removal
  // asserted above — poll the store for the rewrite instead of reading it once.
  await expect
    .poll(async () => (await getCanonItem(page, seededItem.id))?.aisleId, { timeout: SYNC_TIMEOUT })
    .toBeNull();

  const updatedItem = await getCanonItem(page, seededItem.id);
  expect(updatedItem).not.toBeNull();
  expect(updatedItem?.needs_approval).toBe(true);
});
