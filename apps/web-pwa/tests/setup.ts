import '@testing-library/jest-dom/vitest';
import { afterEach, expect } from 'vitest';
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
