/**
 * The chat review gate, on both of its doors (issue #764).
 *
 * Amending a recipe by chat is reachable two ways — the recipe page's chat
 * sidebar, and the full `/chat/:id` page — and the propose/merge/apply logic
 * behind them used to be written twice. The copies drifted: the sidebar
 * preserved metadata the librarian omitted, the chat page spread the draft
 * straight through, so the same conversation came back proposing to erase
 * Serves 4, all three times and every tag. Both doors now call the one merge in
 * `src/lib/recipeAmend.ts`, and these two tests are the pin on that: same
 * conversation, same seeded dish, same assertions, one per surface.
 *
 * Runs against the Firestore + Auth emulators with the MODEL faked
 * (FUNCTIONS_AI_FAKE) and every other layer live — the callable boundary, the
 * Genkit flows, the Firestore write and the realtime subscription.
 *
 *   stubAi('chefChat' | 'generateChatTitle' | 'authorRecipe', …)
 *     → ⋮ → Ask/amend opens a chat on the dish
 *       → a message runs the real chefChat callable against the fake model
 *         → "Review changes" runs the real authorRecipe callable, whose canned
 *           answer OMITS servings, all three times and the tags
 *           → the diff proposes the title change and NOTHING about metadata
 *             → Apply writes a document that still has Serves 4, 15/30/45 and
 *               its tag
 *
 * No `parseRecipeIngredients` stub, deliberately: the librarian's canned answer
 * repeats the seeded ingredient's rawText verbatim, which is exactly what edit
 * mode is built to recognise — `assembleRecipeDraft` reuses the existing parse
 * and canon match and never calls the parse or canon flows at all. Adding a stub
 * for a flow this journey does not reach would only suggest it does.
 *
 * Left on the project's 1280x720 desktop default: above `lg` the chat docks as a
 * column, which is the sidebar surface test 1 needs. The drawer below `lg` is
 * the same button calling the same handler (`reviewChangesAction` is rendered
 * for both), so it is covered by the sidebar test and not driven separately.
 */
import { expect, test } from './fixtures/test';
import { gotoAndSignIn, uniqueEmail } from './helpers/auth';
import { SYNC_TIMEOUT } from './helpers/timeouts';
import type { ChatSessionDoc } from '@salt/domain/schemas';
import type { Recipe } from '@salt/domain';
import type { Page } from '@playwright/test';

const DISH = 'Review Gate Pilaf';
const INGREDIENT = '200 g chorizo, sliced';
const STEP = 'Fry the chorizo until the oil runs red.';
const TAG = 'reviewgate';

// The metadata the user typed, which the librarian is about to forget. Both
// tests assert the saved document still holds exactly this — the same expected
// value checked on both surfaces IS the "identical saved document" assertion.
const SEEDED_METADATA = {
  servings: 4,
  prepTimeMinutes: 15,
  cookTimeMinutes: 30,
  totalTimeMinutes: 45,
  tags: [TAG],
};

const USER_MESSAGE = 'add some chilli';
const STUB_REPLY =
  'Deterministic stubbed chef reply: half a teaspoon of chilli flakes, stirred in.';
const STUB_CHAT_TITLE = 'Stubbed Chilli Conversation';

// The librarian's canned answer: the change the user asked for is in the title
// and the method, and the metadata it was never asked about is DROPPED — null
// servings, null times, no tags. That omission is the defect this spec exists
// for. The ingredient repeats the seeded rawText verbatim, as edit mode
// instructs, so it is carried over rather than re-parsed.
const AMENDED_TITLE = 'Stubbed Chilli Pilaf';
const AMENDED_STEP = 'Fry the chorizo, then stir in the chilli flakes.';

const STUB_AUTHOR = {
  title: AMENDED_TITLE,
  description: 'The pilaf, with chilli.',
  servings: null,
  totalTimeMinutes: null,
  prepTimeMinutes: null,
  cookTimeMinutes: null,
  tags: [],
  ingredientGroups: [
    {
      name: null,
      ingredients: [{ rawText: INGREDIENT, isOptional: false, firstUsedInStepOrdinal: 0 }],
    },
  ],
  steps: [{ text: AMENDED_STEP, timerMinutes: null, timerLabel: null, note: null }],
  notes: null,
};

async function getRecipes(page: Page): Promise<Recipe[]> {
  return page.evaluate<Recipe[]>(() => window.__e2e!.getRecipes() as Recipe[]);
}

async function getSessions(page: Page): Promise<ChatSessionDoc[]> {
  return page.evaluate<ChatSessionDoc[]>(() => window.__e2e!.getChatSessions() as ChatSessionDoc[]);
}

/** Register every canned model answer this journey reaches, before driving the UI. */
async function stubModel(page: Page): Promise<void> {
  await page.evaluate((r) => window.__e2e!.stubAi('chefChat', r), STUB_REPLY);
  await page.evaluate((t) => window.__e2e!.stubAi('generateChatTitle', t), STUB_CHAT_TITLE);
  await page.evaluate((a) => window.__e2e!.stubAi('authorRecipe', a), STUB_AUTHOR);
}

/** Creates the dish through the editor and returns its id. */
async function seedDish(page: Page): Promise<string> {
  await page.goto('/#/recipes/new');
  await expect(page.getByRole('heading', { name: /new recipe/i })).toBeVisible();
  await page.getByTestId('recipe-title-input').fill(DISH);

  await page.getByTestId('recipe-servings-input').fill(String(SEEDED_METADATA.servings));
  await page.getByTestId('recipe-prep-input').fill(String(SEEDED_METADATA.prepTimeMinutes));
  await page.getByTestId('recipe-cook-input').fill(String(SEEDED_METADATA.cookTimeMinutes));
  await page.getByTestId('recipe-total-input').fill(String(SEEDED_METADATA.totalTimeMinutes));
  await page.getByTestId('recipe-tags-input').fill(TAG);
  await page.getByTestId('recipe-tags-input').press('Enter');

  await page.getByTestId('recipe-add-group-btn').click();
  // .nth(0) indexes the single group row THIS test just added — its own set.
  const group0 = page.getByTestId('recipe-group').nth(0);
  await group0.getByTestId('recipe-add-ingredient-btn').click();
  await group0.getByTestId('recipe-ingredient-input').nth(0).fill(INGREDIENT);

  await page.getByTestId('recipe-add-step-btn').click();
  await page.getByTestId('recipe-step-input').nth(0).fill(STEP);

  await page.getByTestId('recipe-save-btn').click();
  await expect(page).toHaveURL(/#\/recipes\/(?!new)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });
  const id = page.url().match(/#\/recipes\/([a-z0-9-]+)/)?.[1];
  expect(id).toBeTruthy();

  await expect
    .poll(async () => (await getRecipes(page)).find((r) => r.id === id)?.metadata.servings, {
      timeout: SYNC_TIMEOUT,
    })
    .toBe(SEEDED_METADATA.servings);
  return id!;
}

/** ⋮ → Ask/amend, then one turn of conversation. Returns the session id. */
async function talkAboutTheDish(page: Page): Promise<string> {
  await page.getByTestId('recipe-actions-overflow').click();
  await page.getByTestId('recipe-ask-amend-menu-item').click();

  await page.getByTestId('chat-input').fill(USER_MESSAGE);
  await page.getByTestId('chat-send-btn').click();
  await expect(page.getByTestId('chat-message-user').filter({ hasText: USER_MESSAGE })).toBeVisible(
    {
      timeout: SYNC_TIMEOUT,
    },
  );
  // The assistant turn is what unlocks "Review changes" on both surfaces.
  await expect(
    page.getByTestId('chat-message-assistant').filter({ hasText: STUB_REPLY }),
  ).toBeVisible({ timeout: 30_000 });

  const session = (await getSessions(page))[0];
  expect(session).toBeTruthy();
  return session!.id;
}

/**
 * The heart of both tests: the summary is open, it proposes the change that was
 * discussed, and it proposes NOTHING about the metadata the librarian dropped.
 * `RecipeChangeSummary` renders a group per section, so an absent group is an
 * absent proposal — and before the fix, the metadata and tag groups were both
 * present here on the full chat page, offering to erase what the user typed.
 */
async function expectNoMetadataRemovalProposed(page: Page): Promise<void> {
  await expect(page.getByTestId('recipe-change-summary')).toBeVisible({ timeout: 60_000 });
  // The positive signal first — the diff really did compute and really did see
  // the change — so the two absence checks below are read from a settled sheet.
  await expect(page.getByTestId('recipe-change-group-basics')).toContainText(AMENDED_TITLE);
  await expect(page.getByTestId('recipe-change-group-metadata')).toHaveCount(0);
  await expect(page.getByTestId('recipe-change-group-tags')).toHaveCount(0);
}

/** Waits for the applied save to land, and hands back the document it wrote. */
async function savedRecipeAfterApply(page: Page, recipeId: string): Promise<Recipe> {
  await expect
    .poll(async () => (await getRecipes(page)).find((r) => r.id === recipeId)?.title, {
      timeout: SYNC_TIMEOUT,
    })
    .toBe(AMENDED_TITLE);
  return (await getRecipes(page)).find((r) => r.id === recipeId)!;
}

test.describe('recipes — the chat review gate', () => {
  test('from the recipe page sidebar: applies the change and keeps the metadata the librarian dropped', async ({
    page,
  }, testInfo) => {
    // 120s: a seed save, a chat round-trip and a librarian round-trip through the
    // emulator, each gated on its own signal-bound wait.
    test.setTimeout(120_000);
    // Recipes are gated to admins while the module is incomplete (#179).
    await gotoAndSignIn(page, uniqueEmail(testInfo.testId), '/', { admin: true });
    await stubModel(page);

    const recipeId = await seedDish(page);
    await talkAboutTheDish(page);

    await page.getByTestId('sidebar-apply-changes-btn').click();
    await expectNoMetadataRemovalProposed(page);

    await page.getByTestId('recipe-change-apply').click();
    const saved = await savedRecipeAfterApply(page, recipeId);
    expect(saved.title).toBe(AMENDED_TITLE);
    // The payoff: what the user typed is still there, on this surface and the other.
    expect(saved.metadata).toEqual(SEEDED_METADATA);
  });

  test('from the full chat page: applies the change and keeps the metadata the librarian dropped', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await gotoAndSignIn(page, uniqueEmail(testInfo.testId), '/', { admin: true });
    await stubModel(page);

    const recipeId = await seedDish(page);
    const sessionId = await talkAboutTheDish(page);

    // The same conversation, through the other door.
    await page.goto(`/#/chat/${sessionId}`);
    await expect(page.getByTestId('chat-apply-changes-btn')).toBeVisible({ timeout: SYNC_TIMEOUT });
    await page.getByTestId('chat-apply-changes-btn').click();
    await expectNoMetadataRemovalProposed(page);

    await page.getByTestId('recipe-change-apply').click();
    // Applying from here lands you on the dish you just changed.
    await expect(page).toHaveURL(new RegExp(`#/recipes/${recipeId}$`), { timeout: SYNC_TIMEOUT });
    const saved = await savedRecipeAfterApply(page, recipeId);
    expect(saved.title).toBe(AMENDED_TITLE);
    // The same expected value as the sidebar test: one merge, one outcome.
    expect(saved.metadata).toEqual(SEEDED_METADATA);
  });
});
