import { afterAll, expect } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';
import '@testing-library/jest-dom/vitest';
expect.extend(axeMatchers);

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
