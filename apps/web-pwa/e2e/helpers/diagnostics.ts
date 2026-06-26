/// <reference path="../../src/lib/types/e2e.d.ts" />
/**
 * Flake-diagnosability instrumentation (e2e, Phase 3).
 *
 * PURE DIAGNOSTICS — these helpers MUST NEVER change a pass/fail outcome or
 * alter any assertion. A passing run is byte-identical in outcome; this code
 * only enriches FAILURE output so the next CI flake (especially a convergence
 * timeout) is diagnosable from the downloaded Playwright artifacts alone.
 *
 * Every public function is fully guarded: a closed / navigated page, a thrown
 * getter, or a serialization failure must NEVER turn a test failure into a
 * different error. Diagnostics swallow their own errors.
 */
import type { Page, TestInfo } from '@playwright/test';

/**
 * Single `page.evaluate()` that calls every available sync bridge store-reader,
 * each guarded so one throwing getter doesn't kill the snapshot. Returns a plain
 * structured-clone-serializable object. If `window.__e2e` is absent (page
 * navigated away / bridge not installed) it returns a marker instead.
 *
 * Deliberately excludes `getCanonItem` (needs an id) and `getLDSessionURL`
 * (LaunchDarkly is retired).
 */
async function readStoreSnapshot(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const bridge = window.__e2e;
    if (!bridge) {
      return { __e2e: 'absent' as const };
    }
    // Each reader is guarded individually so one throwing getter still yields
    // a partial snapshot rather than aborting the whole evaluate.
    const guard = <T>(fn: () => T): T | { __error: string } => {
      try {
        return fn();
      } catch (err) {
        return { __error: (err as Error)?.message ?? String(err) };
      }
    };
    return {
      aisles: guard(() => bridge.getAisles()),
      shoppingLists: guard(() => bridge.getShoppingLists()),
      defaultListId: guard(() => bridge.getDefaultListId()),
      shoppingListItems: guard(() => bridge.getShoppingListItems()),
      recipes: guard(() => bridge.getRecipes()),
      mealPlanSnapshot: guard(() => bridge.getMealPlanSnapshot()),
      equipmentManifest: guard(() => bridge.getEquipmentManifest()),
      chatSessions: guard(() => bridge.getChatSessions()),
      canonSynced: guard(() => bridge.isCanonSynced()),
    };
  });
}

/**
 * Builds the store snapshot and attaches it to the test report as JSON.
 *
 * CRITICAL: the entire body is wrapped in try/catch so a diagnostics failure
 * (closed page, navigation, attach failure) can NEVER throw. On internal error
 * it swallows and best-effort attaches a tiny, also-guarded error note.
 */
export async function attachStoreSnapshot(
  testInfo: TestInfo,
  page: Page,
  label: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  try {
    const snapshot = await readStoreSnapshot(page);
    await testInfo.attach(label, {
      body: JSON.stringify({ ...extra, snapshot }, null, 2),
      contentType: 'application/json',
    });
  } catch (err) {
    // Diagnostics must never throw. Best-effort note, also guarded.
    try {
      await testInfo.attach(`${label}:diagnostics-error`, {
        body: JSON.stringify({ error: (err as Error)?.message ?? String(err) }, null, 2),
        contentType: 'application/json',
      });
    } catch {
      // Give up silently — never let diagnostics influence the outcome.
    }
  }
}

/**
 * Wraps a convergence assertion so that on timeout/failure the last-seen store
 * state is attached BEFORE the original error is re-thrown.
 *
 * The original error is re-thrown UNCHANGED so pass/fail is preserved exactly.
 * The `assertion` callback is the caller's existing `expect.poll(...).toX(...)`,
 * passed verbatim.
 */
export async function withConvergenceDiagnostics<T = void>(
  testInfo: TestInfo,
  page: Page,
  label: string,
  assertion: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    return await assertion();
  } catch (err) {
    await attachStoreSnapshot(testInfo, page, `converge-timeout:${label}`, {
      label,
      elapsedMs: Date.now() - start,
      error: (err as Error)?.message,
    });
    throw err;
  }
}

/**
 * Failure-time snapshot: if the test passed (status === expectedStatus) this is
 * a zero-overhead no-op beyond the status check. Otherwise it attaches the
 * primary page's last-seen store state. Fully guarded.
 */
export async function attachFailureSnapshot(testInfo: TestInfo, page: Page): Promise<void> {
  if (testInfo.status === testInfo.expectedStatus) {
    return;
  }
  await attachStoreSnapshot(testInfo, page, 'failure-store-snapshot', {
    status: testInfo.status,
    error: testInfo.error?.message,
  });
}
