// Hero-image encoding for Tier-2 recipe photos (issue #148).
//
// The Tier-1 counterpart (removeFlatBackground) strips the flat background off a
// cartoon pictogram to recover alpha. A recipe hero is the opposite: a full
// photograph we want to keep intact — no background removal, no alpha. This just
// normalises the model's raw output to a sensible, cache-friendly hero: bounded
// dimensions and WebP compression. Kept a pure function over a buffer so it is
// trivially unit-testable, mirroring removeFlatBackground.

// Longest-edge cap. gemini-2.5-flash-image returns ~1024px; we bound to this so a
// larger model can't balloon the stored asset, while staying crisp on a wide
// hero at up to ~2× DPR. `fit: 'inside'` + `withoutEnlargement` never upscales
// and never crops — the full generated frame is preserved and the UI decides the
// visible crop via object-fit.
const MAX_EDGE = 1280;

// WebP quality for a photo. 80 is the sweet spot for photographic content —
// visually lossless at hero size for a fraction of the bytes.
const WEBP_QUALITY = 80;

export interface EncodeHeroImageOptions {
  /** Longest-edge cap in px (default 1280). */
  readonly maxEdge?: number;
  /** WebP quality 1–100 (default 80). */
  readonly quality?: number;
}

/**
 * Re-encodes raw generated image bytes to a bounded, compressed WebP hero.
 * Preserves aspect ratio; never upscales or crops.
 */
export async function encodeHeroImage(
  input: Buffer,
  options: EncodeHeroImageOptions = {},
): Promise<Buffer> {
  // `sharp` is a heavy native binary — load it lazily so it stays out of the
  // shared Cloud Functions module graph and only the image path pays for it
  // (same rationale as removeFlatBackground, issue #412).
  const sharp = (await import('sharp')).default;

  const maxEdge = options.maxEdge ?? MAX_EDGE;
  const quality = options.quality ?? WEBP_QUALITY;

  return sharp(input)
    .rotate() // honour any EXIF orientation before we drop metadata
    .resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality })
    .toBuffer();
}
