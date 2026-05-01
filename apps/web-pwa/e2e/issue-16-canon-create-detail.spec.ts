import { test, expect } from './fixtures/test';
import { signIn, uniqueEmail } from './helpers/auth';
import { seedAisles, seedCanonItem, getCanonItem } from './helpers/seed';
import { canonCreatePage, canonDetailPage } from './helpers/locators';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Type a name into the combobox and submit it as a new item. */
async function createViaCombobox(page: import('@playwright/test').Page, name: string) {
  const ui = canonCreatePage(page);
  await ui.comboboxInput.fill(name);
  await page.getByRole('option', { name: new RegExp(`Create "${name}"`, 'i') }).click();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test('create truly new item → navigates to detail page', async ({ page }, testInfo) => {
  const email = uniqueEmail(testInfo.testId);
  await page.goto('/');
  await signIn(page, email);

  await page.goto('/#/canon/new');
  await expect(page.getByRole('heading', { name: /add ingredient/i })).toBeVisible();

  await createViaCombobox(page, 'Garlic Powder');

  // Should navigate away from /canon/new to a detail page
  await expect(page).toHaveURL(/#\/canon\/(?!new)[a-z0-9-]+$/);
  await expect(canonDetailPage(page).nameInput).toHaveValue('Garlic Powder');
});

test('pick existing from combobox → routes to detail without creating', async ({
  page,
}, testInfo) => {
  const email = uniqueEmail(testInfo.testId);
  await page.goto('/');
  await signIn(page, email);

  const seeded = await seedCanonItem(page, { name: 'Olive Oil' });

  await page.goto('/#/canon/new');
  await expect(page.getByRole('heading', { name: /add ingredient/i })).toBeVisible();

  const ui = canonCreatePage(page);
  await ui.comboboxInput.fill('Olive');
  await page.getByRole('option', { name: 'Olive Oil' }).click();

  // Navigates to the existing item's detail page, not a new one
  await expect(page).toHaveURL(new RegExp(`#/canon/${seeded.id}$`));
  // No new item should have been created
  const fetched = await getCanonItem(page, seeded.id);
  expect(fetched?.id).toBe(seeded.id);
});

test('create matching name → confirm dialog → use existing → routes to existing', async ({
  page,
}, testInfo) => {
  const email = uniqueEmail(testInfo.testId);
  await page.goto('/');
  await signIn(page, email);

  const seeded = await seedCanonItem(page, { name: 'Butter' });

  await page.goto('/#/canon/new');
  await expect(page.getByRole('heading', { name: /add ingredient/i })).toBeVisible();

  // Submit the same name (lowercased) — stage-1 match, decision=matched
  await createViaCombobox(page, 'butter');

  const ui = canonCreatePage(page);
  await expect(ui.matchDialog).toBeVisible();
  await expect(page.getByText(/Butter/i)).toBeVisible();

  await ui.useExistingButton.click();

  // Should navigate to the existing item
  await expect(page).toHaveURL(new RegExp(`#/canon/${seeded.id}$`));
});

test('create matching name → confirm dialog → create anyway → creates new item', async ({
  page,
}, testInfo) => {
  const email = uniqueEmail(testInfo.testId);
  await page.goto('/');
  await signIn(page, email);

  const seeded = await seedCanonItem(page, { name: 'Milk' });

  await page.goto('/#/canon/new');
  await expect(page.getByRole('heading', { name: /add ingredient/i })).toBeVisible();

  await createViaCombobox(page, 'milk');

  const ui = canonCreatePage(page);
  await expect(ui.matchDialog).toBeVisible();

  await ui.createAnywayButton.click();

  // Should navigate to a DIFFERENT item, not the seeded one
  await expect(page).toHaveURL(/#\/canon\/(?!new)[a-z0-9-]+$/);
  const newUrl = page.url();
  const newId = newUrl.split('/').pop()!;
  expect(newId).not.toBe(seeded.id);

  // Both items exist
  const original = await getCanonItem(page, seeded.id);
  const duplicate = await getCanonItem(page, newId);
  expect(original).not.toBeNull();
  expect(duplicate).not.toBeNull();
});

test('detail page — rename item', async ({ page }, testInfo) => {
  const email = uniqueEmail(testInfo.testId);
  await page.goto('/');
  await signIn(page, email);

  const seeded = await seedCanonItem(page, { name: 'Skim Milk' });

  await page.goto(`/#/canon/${seeded.id}`);
  const ui = canonDetailPage(page);
  await expect(ui.nameInput).toHaveValue('Skim Milk');

  await ui.nameInput.fill('Whole Milk');
  await ui.nameSave.click();

  await expect
    .poll(async () => {
      const item = await getCanonItem(page, seeded.id);
      return item?.name;
    })
    .toBe('Whole Milk');
});

test('detail page — edit synonyms', async ({ page }, testInfo) => {
  const email = uniqueEmail(testInfo.testId);
  await page.goto('/');
  await signIn(page, email);

  const seeded = await seedCanonItem(page, { name: 'Coriander' });

  await page.goto(`/#/canon/${seeded.id}`);
  const ui = canonDetailPage(page);
  await expect(ui.synonymsInput).toBeVisible();

  await ui.synonymsInput.fill('Cilantro, Chinese parsley');
  await ui.synonymsSave.click();

  await expect
    .poll(async () => {
      const item = await getCanonItem(page, seeded.id);
      return item?.synonyms;
    })
    .toEqual(['Cilantro', 'Chinese parsley']);
});

test('detail page — change aisle', async ({ page }, testInfo) => {
  const email = uniqueEmail(testInfo.testId);
  await page.goto('/');
  await signIn(page, email);

  const [aisle] = await seedAisles(page, ['Produce']);
  const seeded = await seedCanonItem(page, { name: 'Carrot' });

  await page.goto(`/#/canon/${seeded.id}`);
  const ui = canonDetailPage(page);
  await ui.aisleTrigger.click();
  await page.getByRole('option', { name: 'Produce' }).click();

  await expect
    .poll(async () => {
      const item = await getCanonItem(page, seeded.id);
      return item?.aisleId;
    })
    .toBe(aisle!.id);
});

test('detail page — delete item navigates back to canon list', async ({ page }, testInfo) => {
  const email = uniqueEmail(testInfo.testId);
  await page.goto('/');
  await signIn(page, email);

  const seeded = await seedCanonItem(page, { name: 'Mango' });

  await page.goto(`/#/canon/${seeded.id}`);
  const ui = canonDetailPage(page);
  await ui.deleteButton.click();
  await expect(ui.deleteDialog).toBeVisible();
  await ui.deleteConfirm.click();

  await expect(page).toHaveURL(/#\/canon$/);

  const deleted = await getCanonItem(page, seeded.id);
  expect(deleted).toBeNull();
});
