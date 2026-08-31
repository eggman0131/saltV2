import { afterAll, expect } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';
import type { AxeMatchers } from 'vitest-axe/matchers';
import '@testing-library/jest-dom/vitest';
expect.extend(axeMatchers);

// Declare what `expect.extend` above actually registered. Without this the 56
// `expect(await axe(...)).toHaveNoViolations()` calls in this tree are TS2339s
// (issue #1135) — the matcher exists at runtime and is unknown to the compiler.
// vitest-axe ships its own augmentation at `vitest-axe/extend-expect`, but it
// targets the `namespace Vi` globals Vitest dropped, so importing it types
// nothing under Vitest 4. The shape below mirrors what
// `@testing-library/jest-dom/vitest` does for its matchers on this Vitest.
declare module 'vitest' {
  interface Assertion extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}

// No `configure({ asyncUtilTimeout })` here, deliberately (issue #793). The
// web-pwa project sets one because its waits were measurably dying on the 1000ms
// library default under load; this project was asked the same question and the
// evidence said no. Across 41 full-suite runs with the CPU saturated (`pnpm soak`)
// not one test in here failed, at any load. The exposure is not obviously lower —
// `Select`/`DropdownInSheet` wait on bits-ui focus and listbox mounting, the same
// shape of wait that failed next door — so if a flake ever does surface here, soak
// it first and then copy web-pwa's `configure()` call. Adding it now would be
// setting a number no measurement here asked for.

// When the last Dialog/Sheet (bits-ui) unmounts, bits-ui's body-scroll-lock
// schedules a `window.setTimeout` (24ms by default) to restore <body> styles.
// If that timer is still pending when Vitest tears down this file's jsdom
// environment, its `resetBodyStyle` callback runs with `document` already gone
// and throws `ReferenceError: document is not defined` — an *unhandled* error
// that fails the whole test run even though every test passed. Give any pending
// cleanup a tick to flush while `document` still exists.
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
});
