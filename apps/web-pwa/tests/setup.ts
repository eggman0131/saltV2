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
