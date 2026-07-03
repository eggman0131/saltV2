// VIOLATION: web-pwa must reach UI primitives (bits-ui / shadcn-svelte /
// melt-ui) only through @salt/ui-components (Rule 7). A direct import bypasses
// the wrapper layer. Expected: no-restricted-imports error.
// @ts-nocheck — bits-ui is intentionally NOT a web-pwa dependency; the lint rule
// is what enforces the boundary, not module resolution.
import { Dialog } from 'bits-ui';
console.log(Dialog);
