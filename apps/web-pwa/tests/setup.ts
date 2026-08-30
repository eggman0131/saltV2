import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/svelte';
import { afterAll, afterEach, expect } from 'vitest';
import * as matchers from 'vitest-axe/matchers';
expect.extend(matchers);

// How long an unqualified `waitFor` / `findBy*` may wait for its condition.
//
// `@testing-library/dom` defaults this to 1000ms and nothing here ever set it, so
// every async wait in this suite ran on a budget nobody chose. That budget is a
// REAL-CLOCK one, and this project runs ~nCPU jsdom worker threads (`pool:
// 'threads'`), so on a loaded machine a correct wait loses the CPU for long enough
// to expire before the state it is waiting for can be observed. Measured on
// 2026-08-11 at load average 9.4: victims died at 1048ms, 1064ms, 1100ms and
// 1105ms — the default expiring, almost to the millisecond — and every one of them
// passed on its own immediately afterwards. It reached CI too (PR #792's Unit job,
// 1105ms), which is why this belongs in shared setup and not a local override.
//
// This is a scheduling-jitter allowance, NOT a retry. A retry re-runs a failed test
// and calls the second result the answer; this only lets a correct wait observe the
// state it was always waiting for. `waitFor` polls and resolves the instant its
// predicate holds, so a passing test is not one millisecond slower — the only cost
// is that a genuinely failing wait takes longer to report. Nothing here rescues a
// wait whose predicate does not gate what the test then asserts; that is a test bug
// and gets fixed as one (see `CookModePage.test.ts`'s ad-hoc timer test).
//
// Keep this comfortably below `testTimeout` in `vitest.config.ts`, or a test with
// several sequential waits reports a vitest timeout instead of the far more useful
// `waitFor` failure. See issue #793.
configure({ asyncUtilTimeout: 5_000 });

// Dialog/AlertDialog primitives (bits-ui) make the page inert while open by
// setting `pointer-events: none` on <body>, and restore it in a close-time
// effect. When a test ends with a dialog still mounted, Testing Library's
// auto-cleanup unmounts the component before that restore effect flushes, so
// the inert style leaks onto <body> and the *next* test's user-event clicks
// fail with "element has `pointer-events: none`". Reset it after every test so
// dialog tests can't poison their successors. Harmless when no dialog ran.
afterEach(() => {
  document.body.style.pointerEvents = '';
});

// jsdom ships no `window.matchMedia`.
//
// This stub was originally here because Svelte's `prefersReducedMotion`
// (`svelte/motion`) builds a `MediaQuery` at MODULE level, so any component
// importing it threw on import and the whole file failed to collect before a
// single test ran. NOTHING IMPORTS `svelte/motion` ANY MORE — issue #933 pointed
// `lib/deckSpring.svelte.ts`, its last consumer, at `lib/reducedMotion.ts` like
// its five siblings — so that is no longer the reason.
//
// It stays for a plainer one: every media read in the app is guarded and answers
// `false` when `matchMedia` is missing, so without a stub the suite would exercise
// the "cannot ask" path everywhere and never the ordinary one. `matches: false`
// reports "no reduced-motion preference, phone-sized viewport", which is the
// honest default for a headless run — the motion-reduce and two-pane branches
// belong to a real browser, or to a test that supplies its own stub (see
// `CatalogPage.docked.test.ts`, `RecipeViewPage.docked.test.ts`).
if (typeof window.matchMedia !== 'function') {
  // `vi.fn` cannot satisfy `matchMedia`'s overloads, so the assignment needs the
  // cast; the stub is complete for everything the code under test reads.
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: false,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// jsdom ships no ResizeObserver, and cook mode's guided-step deck uses one to
// re-measure its viewport (`CookModePage.svelte`). The call site is guarded
// (`typeof ResizeObserver !== 'function'`), so its absence is not a crash — it is a
// silent early return that skips the branch under test and lets the test pass for
// the wrong reason. Defining it puts the real code path back.
//
// The stub is deliberately inert. jsdom lays nothing out, so there is no size change
// for a real observer to report; anything that depends on measured geometry (chip
// clipping, peek height, fade height) is Playwright's job, not jsdom's.
if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    // Cast: the class omits the static/`prototype` shape of the real constructor.
  } as unknown as typeof ResizeObserver;
}

// jsdom implements PointerEvent but not the Pointer Capture API, so a component that
// captures the pointer for the life of a drag (the cook-mode deck does) finds the
// methods missing. Same shape of problem as above: every call site optional-chains,
// so the gap reads as "capture skipped" rather than "capture broken". The stub tracks
// captured pointer ids honestly enough that `hasPointerCapture` answers correctly;
// jsdom has no real pointer stream to redirect, so redirection is all it can't do.
if (typeof Element.prototype.setPointerCapture !== 'function') {
  const captured = new WeakMap<Element, Set<number>>();
  Element.prototype.setPointerCapture = function (pointerId: number): void {
    const ids = captured.get(this) ?? new Set<number>();
    ids.add(pointerId);
    captured.set(this, ids);
  };
  Element.prototype.releasePointerCapture = function (pointerId: number): void {
    captured.get(this)?.delete(pointerId);
  };
  Element.prototype.hasPointerCapture = function (pointerId: number): boolean {
    return captured.get(this)?.has(pointerId) ?? false;
  };
}

// jsdom lays nothing out and so ships no `scrollIntoView`. Any component that keeps a
// message list pinned to the bottom calls it unguarded from an $effect (the recipe
// page's chat sidebar does), and an undefined method there throws inside the effect and
// fails the render — an environment gap reported as a component bug. The stub is inert
// by necessity: there is no scroll position in jsdom to move. Whether the list actually
// scrolls is Playwright's job.
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function (): void {};
}

// `requestAnimationFrame`/`cancelAnimationFrame` are deliberately NOT stubbed here:
// Vitest runs its jsdom environment with `pretendToBeVisual: true`, which already
// provides both on a ~16ms real-time clock. The deck's spring integrator therefore
// runs for real and settles on its own. Replacing them with a synchronous or no-op
// stub would either spin the spring to completion inside a single tick or stop it
// from ever settling — both worse than the real thing.

// When the last Dialog/Sheet (bits-ui) unmounts, bits-ui's body-scroll-lock
// schedules a `window.setTimeout` (24ms by default) to restore <body> styles.
// If that timer is still pending when Vitest tears down this file's jsdom
// environment, its `resetBodyStyle` callback runs with `document` already gone
// and throws `ReferenceError: document is not defined` — an *unhandled* error
// that fails the whole test run even though every test passed (a real CI flake:
// depends on whether the last file happens to end with a lock still pending).
// Give any pending cleanup a tick to flush while `document` still exists.
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
});
