/**
 * Recipe notes formatting E2E (issue #717, Phase 2).
 *
 * Covers the editor half of Markdown notes: the Bold/Italic/List toolbar acting
 * on the real textarea selection, the Edit/Preview toggle rendering through the
 * same `<Markdown … breaks />` the view page uses, and the fact that none of it
 * changes what gets saved — `notes` stays a plain Markdown string.
 *
 * No AI and no second tab: everything here is single-tab local state plus one
 * Firestore round-trip on save, so SYNC_TIMEOUT is the only budget needed.
 */
import { expect, test } from './fixtures/test';
import { gotoAndSignIn, uniqueEmail } from './helpers/auth';
import { SYNC_TIMEOUT } from './helpers/timeouts';

// A phone, pinned explicitly — same reason as `recipe-crud.spec.ts`: the recipe
// view page docks its chat column from 700x480 up, and the notes assertions at
// the end of this spec are written for the single-column layout. It also puts
// the toolbar + Edit/Preview row on the width that actually has to fit them.
test.use({ viewport: { width: 393, height: 851 } });

test.describe('recipes — notes formatting toolbar and preview', () => {
  test('toolbar formats the selection, preview renders it, save keeps it plain text', async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    const email = uniqueEmail(testInfo.testId);
    // Recipes are gated to admins while the module is incomplete (#179).
    await gotoAndSignIn(page, email, '/', { admin: true });

    await page.goto('/#/recipes/new');
    await expect(page.getByRole('heading', { name: /new recipe/i })).toBeVisible();
    await page.getByTestId('recipe-title-input').fill('Notes Formatting Test');

    const notes = page.getByTestId('recipe-notes-input');

    /**
     * Select the last `length` characters by walking left with Shift held.
     *
     * Deliberately not `Shift+Home`: on macOS Chromium, Home is
     * "start of document", not "start of line", so a line-based selection
     * silently means something different locally than it does on the Linux CI
     * runners. Arrow keys move one character on every platform.
     */
    async function selectLastChars(length: number): Promise<void> {
      for (let i = 0; i < length; i++) await notes.press('Shift+ArrowLeft');
    }

    // ── Bold wraps a selection inside the line, not the whole line ───────────
    await notes.fill('watch the salt');
    await selectLastChars('salt'.length);
    await page.getByTestId('recipe-notes-bold-btn').click();
    await expect(notes).toHaveValue('watch the **salt**');

    // ── Italic wraps a selection on a second line ────────────────────────────
    // The toolbar leaves the caret at the end of what it inserted, which here is
    // the end of the text — so typing continues from there.
    await notes.pressSequentially('\nghee not butter');
    await selectLastChars('butter'.length);
    await page.getByTestId('recipe-notes-italic-btn').click();
    await expect(notes).toHaveValue('watch the **salt**\nghee not *butter*');

    // ── List prefixes the caret's own line, with no selection at all ─────────
    await notes.pressSequentially('\nrest it for ten minutes');
    await page.getByTestId('recipe-notes-list-btn').click();
    await expect(notes).toHaveValue(
      'watch the **salt**\nghee not *butter*\n- rest it for ten minutes',
    );

    // ── Preview renders the Markdown, not the markers ────────────────────────
    await page.getByTestId('recipe-notes-preview-btn').click();
    const preview = page.getByTestId('recipe-notes-preview');
    await expect(preview).toBeVisible();
    // A real list item is the accessible-role proof that `- ` was parsed rather
    // than displayed; the marker assertions prove the same for bold/italic.
    await expect(preview.getByRole('listitem')).toHaveText('rest it for ten minutes');
    await expect(preview).toContainText('watch the salt');
    await expect(preview).not.toContainText('**');
    await expect(preview).not.toContainText('- rest it');
    // The toolbar is gone in preview — there is no selection to act on.
    await expect(page.getByTestId('recipe-notes-bold-btn')).toHaveCount(0);

    // ── Back to Edit loses nothing ───────────────────────────────────────────
    await page.getByTestId('recipe-notes-edit-btn').click();
    await expect(page.getByTestId('recipe-notes-input')).toHaveValue(
      'watch the **salt**\nghee not *butter*\n- rest it for ten minutes',
    );

    // ── Save (from preview mode) persists the same plain Markdown ────────────
    await page.getByTestId('recipe-notes-preview-btn').click();
    await page.getByTestId('recipe-save-btn').click();
    await expect(page).toHaveURL(/#\/recipes\/(?!new)[a-z0-9-]+$/, { timeout: SYNC_TIMEOUT });

    // The view page renders it as formatting. `.filter()` rather than `.nth()`:
    // this recipe has no ingredients, but the filter keeps the assertion honest
    // about WHICH list item it means (NF-B3).
    await expect(
      page.getByRole('listitem').filter({ hasText: 'rest it for ten minutes' }),
    ).toHaveCount(1);
    // …and the raw markers are nowhere on the page, which is the bold/italic half.
    await expect(page.getByText('**watch the salt**')).toHaveCount(0);

    // ── Re-open the editor: still the same plain string, no shape change ─────
    await page.getByTestId('recipe-actions-overflow').click();
    await page.getByTestId('recipe-edit-menu-item').click();
    await expect(page.getByRole('heading', { name: /edit recipe/i })).toBeVisible();
    await expect(page.getByTestId('recipe-notes-input')).toHaveValue(
      'watch the **salt**\nghee not *butter*\n- rest it for ten minutes',
      { timeout: SYNC_TIMEOUT },
    );
  });
});
