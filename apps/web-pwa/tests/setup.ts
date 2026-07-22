import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, expect } from 'vitest';
import * as matchers from 'vitest-axe/matchers';
expect.extend(matchers);

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

// jsdom ships no `window.matchMedia`. Svelte's `prefersReducedMotion` (svelte/motion)
// builds a `MediaQuery` at MODULE level, so any component importing it throws on
// import — the whole test file fails to collect, before a single test runs. Reported
// as "no reduced-motion preference", which is the honest default for a headless run:
// the motion-reduce branches stay unexercised here and belong to a real browser.
if (typeof window.matchMedia !== 'function') {
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
