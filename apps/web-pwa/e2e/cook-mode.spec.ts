/**
 * Cook mode E2E (issue #556, Phase 5) — the whole cook against real Firestore,
 * real security rules, and a real layout engine.
 *
 * What lives HERE because nowhere else can reach it:
 * - **Which step the footer acts on once the deck has actually moved.** The
 *   footer's target comes from a geometric probe (`probeVisibleStep`), so in
 *   jsdom it never resolves and the footer silently falls back to "first
 *   incomplete" — a fallback that happens to give the right answer whether or
 *   not the deck moved. Only a real engine can tell the two apart.
 * - **The first-use chip cap.** `expandChip` decides by measuring
 *   `scrollWidth > clientWidth`; without layout that is never true, so every
 *   jsdom tap returns early and the expand/collapse behaviour is unreachable.
 * - **Resume across a real reload** — session doc + mise ticks rehydrated from
 *   Firestore through the real adapter, not a mocked store.
 *
 * Deliberately NOT here (Phase 2–4 cover them in milliseconds): step timers,
 * the recipe-changed banner, restart, the deleted-recipe orphan path, and the
 * fling-landing decision — that last one is pure arithmetic in `$lib/cookDeck`
 * and is unit tested, whereas synthesised pointer physics in CI is flake rather
 * than signal. The deck is therefore driven by the footer and the keyboard.
 */
import type { Locator, Page } from '@playwright/test';
import type { Recipe } from '@salt/domain';
import { expect, test } from './fixtures/test';
import { gotoAndSignIn, uniqueEmail } from './helpers/auth';
import { seedRecipe } from './helpers/seed';
import { HYDRATE_TIMEOUT, SYNC_TIMEOUT } from './helpers/timeouts';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const RECIPE_ID = 'e2e-cook-recipe';
const SEED_TIME = '2026-01-01T00:00:00.000Z'; // persistRecipe re-stamps updatedAt

interface StepSpec {
  readonly id: string;
  readonly text: string;
}

interface IngredientSpec {
  readonly rawText: string;
  /** The step this ingredient is first needed in — what drives the chip row. */
  readonly step: string;
}

/**
 * A whole recipe document, shaped for cook mode. `parsed: null` on every
 * ingredient makes `IngredientText` render `rawText` verbatim, so a chip's
 * on-screen width is a direct function of the seeded string — which is what the
 * layout assertions below depend on.
 */
function buildRecipe(steps: readonly StepSpec[], ingredients: readonly IngredientSpec[]): Recipe {
  return {
    id: RECIPE_ID,
    schemaVersion: 1,
    title: 'Emulator Ragù',
    description: null,
    ingredients: [
      {
        id: 'group-1',
        name: null,
        items: ingredients.map((ing, index) => ({
          id: `ing-${index + 1}`,
          rawText: ing.rawText,
          parsed: null,
          canonId: null,
          matchState: 'pending' as const,
          isOptional: false,
          firstUsedInStepId: ing.step,
        })),
      },
    ],
    steps: steps.map((s) => ({ id: s.id, text: s.text, timer: null, note: null })),
    metadata: {
      servings: 4,
      totalTimeMinutes: null,
      prepTimeMinutes: null,
      cookTimeMinutes: null,
      tags: [],
    },
    source: null,
    notes: null,
    producesCanonId: null,
    image: null,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
  };
}

const JOURNEY_STEP_COUNT = 4;
const JOURNEY_INGREDIENT_COUNT = 7;

function journeyRecipe(): Recipe {
  return buildRecipe(
    [
      { id: 'step-1', text: 'Warm the oil in a heavy pan over a low flame.' },
      { id: 'step-2', text: 'Soften the onion, carrot and celery for ten minutes.' },
      { id: 'step-3', text: 'Add the tomatoes and simmer until the sauce turns glossy.' },
      { id: 'step-4', text: 'Season, then fold the drained pasta through the sauce.' },
    ],
    [
      { rawText: '3 tbsp olive oil', step: 'step-1' },
      { rawText: '1 onion, finely diced', step: 'step-2' },
      { rawText: '1 carrot, finely diced', step: 'step-2' },
      { rawText: '2 sticks celery, finely diced', step: 'step-2' },
      { rawText: '400g tinned plum tomatoes', step: 'step-3' },
      { rawText: 'Sea salt', step: 'step-4' },
      { rawText: '500g rigatoni', step: 'step-4' },
    ],
  );
}

// Two deliberately long lines plus three short ones, ALL first used in step 1 —
// so exactly one chip row exists in the deck and it can be addressed without a
// structural locator. The long pair is what proves the cap; the short ones are
// what prove a chip that already reads in full is inert.
const LONG_TOMATOES = '400g tinned plum tomatoes, drained and roughly chopped';
const LONG_OIL = '3 tbsp extra-virgin olive oil, plus more for drizzling';
const CHIP_STEP_ONE_TEXT = 'Warm the oil, then add everything else to the pan.';

function chipRecipe(): Recipe {
  return buildRecipe(
    [
      { id: 'step-1', text: CHIP_STEP_ONE_TEXT },
      { id: 'step-2', text: 'Simmer for an hour, stirring now and then.' },
      { id: 'step-3', text: 'Check the seasoning and serve.' },
    ],
    [
      { rawText: LONG_TOMATOES, step: 'step-1' },
      { rawText: LONG_OIL, step: 'step-1' },
      { rawText: 'Sea salt', step: 'step-1' },
      { rawText: 'Black pepper', step: 'step-1' },
      { rawText: '1 lemon', step: 'step-1' },
    ],
  );
}

// ─── Shared arrival ───────────────────────────────────────────────────────────

/** Sign in, seed the recipe, and enter cook mode the way a cook does — from the
 *  recipe view's Cook button. */
async function startCook(page: Page, email: string, recipe: Recipe): Promise<void> {
  // The deck settles with an UNDER-DAMPED spring: it overshoots its target by
  // ~10% and pulls back, and the footer re-probes which step is on top for every
  // frame of that. A web-first assertion can therefore go green on an overshoot
  // frame, and the very next click would tick the step the deck was passing
  // through rather than the one it came to rest on. Under reduced motion
  // `animateDeckTo` assigns the target offset directly — no frames, no
  // overshoot, exactly one settled state per move. A real user setting, and it
  // makes every deck move deterministic without a single sleep (NF-A1).
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoAndSignIn(page, email, '/');
  await seedRecipe(page, recipe);
  await page.goto(`/#/recipes/${recipe.id}`);
  await page.getByTestId('recipe-cook-button').click();
  await expect(page).toHaveURL(new RegExp(`#/recipes/${recipe.id}/cook$`));
  await expect(page.getByTestId('cook-mode-page')).toBeVisible({ timeout: SYNC_TIMEOUT });
}

/** The timeline segment for a step, addressed by its accessible name. The name
 *  gains ", done" the moment the step is ticked, so the locator itself is the
 *  completion assertion. */
function timelineStep(page: Page, n: number, done = false): Locator {
  return page.getByRole('button', {
    name: `Step ${n} of ${JOURNEY_STEP_COUNT}${done ? ', done' : ''}`,
    exact: true,
  });
}

/** The step the footer is acting on: exactly the one the timeline marks current. */
async function expectFooterOnStep(page: Page, n: number, done = false): Promise<void> {
  await expect(timelineStep(page, n, done)).toHaveAttribute('aria-current', 'step');
}

/** The mise-en-place counter in the header, live only on the mise stage. */
function miseCounter(page: Page): Locator {
  return page.getByText(/Mise en place ·/);
}

// ─── The cook ─────────────────────────────────────────────────────────────────

test.describe('cook mode', () => {
  test('a cook resumes on the step it left off at after a reload, and finishing clears it', async ({
    page,
  }, testInfo) => {
    // Single tab, no AI, no CF trigger — but one full reload + Firestore
    // rehydrate, which is the slowest leg here (NF-F2).
    test.setTimeout(90_000);
    await startCook(page, uniqueEmail(testInfo.testId), journeyRecipe());

    // ── Stage 1: mise en place ────────────────────────────────────────────────
    const miseRows = page.getByTestId('cook-mise-row');
    await expect(miseRows).toHaveCount(JOURNEY_INGREDIENT_COUNT);
    await expect(miseCounter(page)).toHaveText(/0\/7 ready/);

    const oliveOil = miseRows.filter({ hasText: '3 tbsp olive oil' });
    await oliveOil.click();
    await expect(oliveOil).toHaveAttribute('aria-pressed', 'true');
    await expect(miseCounter(page)).toHaveText(/1\/7 ready/, { timeout: SYNC_TIMEOUT });

    await page.getByTestId('cook-mise-check-all').click();
    await expect(miseCounter(page)).toHaveText(/7\/7 ready/, { timeout: SYNC_TIMEOUT });

    // ── Stage 2: guided steps ─────────────────────────────────────────────────
    await page.getByTestId('cook-stage-toggle').click();
    const deck = page.getByTestId('cook-steps-view');
    await expect(deck).toBeVisible();
    await expectFooterOnStep(page, 1);

    // The footer ticks the step you're on and brings the next outstanding one up.
    await page.getByTestId('cook-step-done').click();
    await expectFooterOnStep(page, 2);
    await expect(timelineStep(page, 1, true)).toBeVisible();

    // ── The footer follows the DECK, not the completion list ──────────────────
    // Paging with the keyboard moves the deck without ticking anything, so the
    // footer's target and "first incomplete" diverge — the one state jsdom can
    // never produce, because with no geometry the probe never resolves.
    await deck.press('ArrowDown');
    await expectFooterOnStep(page, 3);
    await expect(timelineStep(page, 2)).toBeVisible(); // paging past it did not tick it
    await deck.press('ArrowUp');
    await expectFooterOnStep(page, 2);

    await page.getByTestId('cook-step-done').click();
    await expectFooterOnStep(page, 3);

    // ── Reload mid-cook ───────────────────────────────────────────────────────
    await page.reload();
    // Straight back into the steps stage rather than mise: the session carries
    // step progress, so reopening a half-cooked recipe resumes it.
    await expect(page.getByTestId('cook-steps-view')).toBeVisible({ timeout: HYDRATE_TIMEOUT });
    await expectFooterOnStep(page, 3);
    await expect(timelineStep(page, 1, true)).toBeVisible();
    await expect(timelineStep(page, 2, true)).toBeVisible();

    // The mise ticks came back too, and the entry label reads the cook back:
    // this is a return to a cook already under way, not a fresh start.
    await page.getByTestId('cook-stage-back').click();
    await expect(miseCounter(page)).toHaveText(/7\/7 ready/);
    await expect(page.getByTestId('cook-stage-toggle')).toHaveText(/Continue cooking/);
    await page.getByTestId('cook-stage-toggle').click();
    await expectFooterOnStep(page, 3);

    // ── Scrolling back onto a done step offers Resume, never Done ─────────────
    await deck.press('ArrowUp');
    await expectFooterOnStep(page, 2, true);
    const resume = page.getByTestId('cook-step-resume');
    await expect(resume).toHaveText(/Resume · step 3/);
    await resume.click();
    await expectFooterOnStep(page, 3);

    // ── Finish ────────────────────────────────────────────────────────────────
    await page.getByTestId('cook-step-done').click();
    await expectFooterOnStep(page, 4);
    await page.getByTestId('cook-step-done').click();
    const finish = page.getByTestId('cook-mode-complete');
    await expect(finish).toBeVisible();
    await finish.click();
    await expect(page).toHaveURL(new RegExp(`#/recipes/${RECIPE_ID}$`), { timeout: SYNC_TIMEOUT });

    // Finishing DELETED the session doc — re-entering starts a clean cook.
    await page.getByTestId('recipe-cook-button').click();
    await expect(miseCounter(page)).toHaveText(/0\/7 ready/, { timeout: SYNC_TIMEOUT });
  });

  // ─── Chip layout ────────────────────────────────────────────────────────────

  test('a first-use chip never exceeds half the step row, so two clipped chips still share one line', async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000); // single tab, no reload
    await startCook(page, uniqueEmail(testInfo.testId), chipRecipe());
    await page.getByTestId('cook-stage-toggle').click();

    const row = page.getByTestId('cook-step-firstuse');
    const chips = page.getByTestId('cook-step-firstuse-chip');
    await expect(chips).toHaveCount(5);

    const tomatoes = chips.filter({ hasText: LONG_TOMATOES });
    const oil = chips.filter({ hasText: LONG_OIL });

    // `toPass` IS the settle here (NF-A3): the deck places itself on the first
    // incomplete step a frame after the chips first paint, so a one-shot
    // boundingBox() read could measure a row that is still moving.
    await expect(async () => {
      const rowBox = (await row.boundingBox())!;
      const half = rowBox.width / 2;
      // The cap is `calc(50% - 0.25rem)`: half the row MINUS half the `gap-2`.
      const cap = half - 4;

      for (const chip of await chips.all()) {
        expect((await chip.boundingBox())!.width).toBeLessThanOrEqual(half);
      }

      // Both long chips sit AT the cap rather than merely being narrow —
      // otherwise "two capped chips share a line" would prove nothing.
      const tomatoesBox = (await tomatoes.boundingBox())!;
      const oilBox = (await oil.boundingBox())!;
      expect(Math.abs(tomatoesBox.width - cap)).toBeLessThan(1.5);
      expect(Math.abs(oilBox.width - cap)).toBeLessThan(1.5);

      // Same line, side by side. A flat 50% would put the pair 8px over the row
      // and wrap the second one — which is the whole reason for the -0.25rem.
      expect(Math.abs(oilBox.y - tomatoesBox.y)).toBeLessThan(1);
      expect(oilBox.x).toBeGreaterThan(tomatoesBox.x);
    }).toPass({ timeout: SYNC_TIMEOUT });
  });

  test('tapping a first-use chip expands it only when its text is clipped, and any click elsewhere collapses it', async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000); // single tab, no reload
    await startCook(page, uniqueEmail(testInfo.testId), chipRecipe());
    await page.getByTestId('cook-stage-toggle').click();

    const row = page.getByTestId('cook-step-firstuse');
    const chips = page.getByTestId('cook-step-firstuse-chip');
    await expect(chips).toHaveCount(5);

    const tomatoes = chips.filter({ hasText: LONG_TOMATOES });
    const salt = chips.filter({ hasText: 'Sea salt' });
    const half = (await row.boundingBox())!.width / 2;

    // A clipped chip lifts its own cap, and only its own — the row is a flex
    // wrap, so the rest reflow around it.
    await tomatoes.click();
    await expect(tomatoes).toHaveAttribute('data-expanded', 'true');
    expect((await tomatoes.boundingBox())!.width).toBeGreaterThan(half);

    // A click anywhere else puts it back.
    await page.getByText(CHIP_STEP_ONE_TEXT).click();
    await expect(tomatoes).toHaveAttribute('data-expanded', 'false');
    expect((await tomatoes.boundingBox())!.width).toBeLessThanOrEqual(half);

    // A chip that already reads in full has nothing to reveal, so tapping it
    // does nothing at all — it merely lets the window-level collapse run, which
    // closes whatever was open. The collapse of `tomatoes` is the settle that
    // proves the click landed; `salt` staying shut is the assertion.
    await tomatoes.click();
    await expect(tomatoes).toHaveAttribute('data-expanded', 'true');
    await salt.click();
    await expect(tomatoes).toHaveAttribute('data-expanded', 'false');
    await expect(salt).toHaveAttribute('data-expanded', 'false');
  });
});
