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
import { writeFile } from 'node:fs/promises';
import type { Page, TestInfo } from '@playwright/test';
import { FLAKE_CONTEXT_ATTACHMENT } from '../reporter/flakeReporter';

// Playwright colourises assertion messages. Written straight into a JSON file
// those escape codes survive as literal noise wrapped around exactly the
// strings you came to read (the expected pattern, the received value), so strip
// them where the message stops being terminal output and becomes an artifact.
// Spelled \u001B rather than a raw ESC byte, matching flakeReporter.ts: an
// invisible control character in source is a trap for the next reader.
const ANSI = /\u001B\[[0-9;]*m/g;

function plainMessage(message: string | undefined): string | undefined {
  return message?.replace(ANSI, '');
}

/**
 * Reduces the store snapshot to flat scalars for `ctx_*` correlation properties.
 *
 * COUNTS AND FLAGS ONLY — never ids, names, or anything free-form. This crosses
 * into a telemetry backend, and while the data here is family-shared, the
 * error-reporting convention (scrub raw user content) applies to anything that
 * leaves the runner. A count answers "was the store empty?", which is the whole
 * question; the ids are already in the full snapshot next to the trace.
 *
 * Each reader may be absent or an `{ __error }` marker from `guard()`, so every
 * field degrades to null independently rather than losing the whole context.
 */
function flakeContextOf(snapshot: unknown): Record<string, number | boolean | null> {
  const store = (snapshot ?? {}) as Record<string, unknown>;
  const countOf = (value: unknown): number | null => (Array.isArray(value) ? value.length : null);
  const boolOf = (value: unknown): boolean | null =>
    typeof value === 'boolean'
      ? value
      : value === null || value === undefined
        ? null
        : Boolean(value);

  const hasDefaultList = typeof store['defaultListId'] === 'string';
  const aislesInCache = probeHeldDocument(store['sdkCacheAisles']);
  const configInCache = probeHeldDocument(store['sdkCacheShoppingListsConfig']);

  // 7 store keys + 4 probe keys = 11, inside CTX_MAX_KEYS (16).
  return {
    aisles_count: countOf(store['aisles']),
    shopping_lists_count: countOf(store['shoppingLists']),
    shopping_list_items_count: countOf(store['shoppingListItems']),
    recipes_count: countOf(store['recipes']),
    chat_sessions_count: countOf(store['chatSessions']),
    has_default_list: hasDefaultList,
    canon_synced: boolOf(store['canonSynced']),
    // Issue #734, the whole point of the probe: did the Firestore SDK's own
    // local cache still hold the document, and does that match what the store
    // shows? `*_in_sdk_cache` true with an empty store means the SDK had it and
    // WE lost it — ours to fix. Both empty means the SDK's local view lost an
    // update it had already received — upstream, not ours.
    aisles_in_sdk_cache: aislesInCache,
    aisles_cache_agrees: agreementOf(aislesInCache, countOf(store['aisles'])),
    shopping_lists_config_in_sdk_cache: configInCache,
    shopping_lists_config_cache_agrees: agreementOf(configInCache, hasDefaultList ? 1 : 0),
  };
}

/**
 * True when the SDK's cache held the document AND it existed there. A probe that
 * is missing, `guard()`ed to an `{ __error }` marker, or reporting its own
 * failure degrades to null rather than to a confident `false`.
 */
function probeHeldDocument(probe: unknown): boolean | null {
  if (!probe || typeof probe !== 'object') return null;
  const p = probe as Record<string, unknown>;
  if (typeof p['error'] === 'string' || typeof p['__error'] === 'string') return null;
  if (typeof p['inCache'] !== 'boolean') return null;
  return p['inCache'] && p['exists'] === true;
}

/** Cache and store tell the same story — both hold the data, or neither does. */
function agreementOf(inCache: boolean | null, storeCount: number | null): boolean | null {
  if (inCache === null || storeCount === null) return null;
  return inCache === storeCount > 0;
}

/**
 * Single `page.evaluate()` that calls every available bridge store-reader plus
 * the Firestore local-cache probe, each guarded so one throwing getter doesn't
 * kill the snapshot. Returns a plain structured-clone-serializable object. If
 * `window.__e2e` is absent (page navigated away / bridge not installed) it
 * returns a marker instead.
 *
 * Deliberately excludes `getCanonItem` (needs an id) and `getLDSessionURL`
 * (LaunchDarkly is retired).
 */
async function readStoreSnapshot(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
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
    // Same guard for the async readers — including a bridge that predates the
    // method (an older bundle), which surfaces as a caught TypeError.
    const guardAsync = async <T>(fn: () => Promise<T>): Promise<T | { __error: string }> => {
      try {
        return await fn();
      } catch (err) {
        return { __error: (err as Error)?.message ?? String(err) };
      }
    };
    // Sync store readers FIRST and awaits after, so the store half of the
    // snapshot is captured at exactly the instant it was before the probe
    // existed — the probe describes the same moment, not one a few ticks later.
    const store = {
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
    // The two documents #721 watched go missing, read straight out of the
    // Firestore SDK's own local cache (issue #734). Network-free, so this
    // cannot perturb the run it is diagnosing.
    const [sdkCacheAisles, sdkCacheShoppingListsConfig] = await Promise.all([
      guardAsync(() => bridge.probeFirestoreCache('canonData/aisles')),
      guardAsync(() => bridge.probeFirestoreCache('shoppingListsConfig/singleton')),
    ]);
    return { ...store, sdkCacheAisles, sdkCacheShoppingListsConfig };
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
    // Written to outputPath and attached BY PATH, not as an inline `body`. An
    // inline body only ever exists base64-encoded inside the HTML report's
    // bundle, so reading it back means unpacking that bundle — which is exactly
    // the wrong amount of friction for the artifact you reach for first when a
    // convergence flake needs explaining. By path it is a plain .json file in
    // test-results/, sitting next to the trace and readable with `cat`.
    const file = testInfo.outputPath(`${label.replace(/[^a-zA-Z0-9]+/g, '-')}.json`);
    await writeFile(file, JSON.stringify({ ...extra, snapshot }, null, 2));
    await testInfo.attach(label, { path: file, contentType: 'application/json' });
    // Same state, second form: a handful of scalars the flake reporter promotes
    // to `ctx_*` event properties. The full snapshot above stays the thing you
    // read; this is the thing you QUERY. "aisles: []" explained a failure in
    // seconds once downloaded — as a property it answers "how many of these
    // failures had an empty aisles store?" across every occurrence at once,
    // which is the difference between a diagnosis and a pattern.
    await testInfo.attach(FLAKE_CONTEXT_ATTACHMENT, {
      body: JSON.stringify(flakeContextOf(snapshot)),
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
      error: plainMessage((err as Error)?.message),
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
    error: plainMessage(testInfo.error?.message),
  });
}
