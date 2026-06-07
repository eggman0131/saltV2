import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Loads the committed canon-icon style seed (issue #148) as a base64 data URI
// for reference-conditioned image generation. The seed is the validated
// red-apple pictogram that locks the house style; prompt-only generation drifts
// (random borders, text leakage), so this reference is mandatory.
//
// Path resolution is relative to this module via import.meta.url so it works
// across toolchains:
//   - dev (tsx) / tests (vitest): this module sits beside the PNG in
//     src/flows/assets/, so `./canon-icon-seed.png` resolves there.
//   - production: esbuild inlines this module into dist/index.js, and the
//     cloud-functions build copies the PNG to dist/ alongside it, so the same
//     `./canon-icon-seed.png` (now relative to dist/index.js) resolves.
//
// The seed-coupled negative clauses in the generation prompt
// (generateCanonIcon.ts) are keyed to THIS seed's subject/colour (red apple);
// swapping the seed means updating those negatives too.

const SEED_CONTENT_TYPE = 'image/png';

let cached: { readonly url: string; readonly contentType: string } | null = null;

export function loadCanonIconSeed(): { readonly url: string; readonly contentType: string } {
  if (cached) return cached;
  const path = fileURLToPath(new URL('./canon-icon-seed.png', import.meta.url));
  const base64 = readFileSync(path).toString('base64');
  cached = { url: `data:${SEED_CONTENT_TYPE};base64,${base64}`, contentType: SEED_CONTENT_TYPE };
  return cached;
}
