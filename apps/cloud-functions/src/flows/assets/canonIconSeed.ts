import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Loads the committed canon-icon style seed (issue #148) as a base64 data URI
// for reference-conditioned image generation. The seed is the validated
// red-apple pictogram that locks the house style; prompt-only generation drifts
// (random borders, text leakage), so this reference is mandatory.
//
// The seed is committed as a 384×384 WebP (issue #236): it only conveys STYLE
// (line weight, outline, palette, plain background), never detail we keep, so it
// is downscaled to a single Gemini input tile (≤384px) and re-encoded as WebP to
// minimise per-call input tokens and payload bytes. Do not restore the original
// 1024px PNG without a reason — the prompt explicitly negative-guides against
// copying the seed's subject, so higher resolution buys nothing.
//
// Path resolution is relative to this module via import.meta.url so it works
// across toolchains:
//   - dev (tsx) / tests (vitest): this module sits beside the WebP in
//     src/flows/assets/, so `./canon-icon-seed.webp` resolves there.
//   - production: esbuild inlines this module into dist/index.js, and the
//     cloud-functions build copies the WebP to dist/ alongside it, so the same
//     `./canon-icon-seed.webp` (now relative to dist/index.js) resolves.
//
// The seed-coupled negative clauses in the generation prompt
// (generateCanonIcon.ts) are keyed to THIS seed's subject/colour (red apple);
// swapping the seed means updating those negatives too.

const SEED_CONTENT_TYPE = 'image/webp';

let cached: { readonly url: string; readonly contentType: string } | null = null;

export function loadCanonIconSeed(): { readonly url: string; readonly contentType: string } {
  if (cached) return cached;
  const path = fileURLToPath(new URL('./canon-icon-seed.webp', import.meta.url));
  const base64 = readFileSync(path).toString('base64');
  cached = { url: `data:${SEED_CONTENT_TYPE};base64,${base64}`, contentType: SEED_CONTENT_TYPE };
  return cached;
}
