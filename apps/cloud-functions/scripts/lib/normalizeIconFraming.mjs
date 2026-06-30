// Icon FRAMING normaliser (issue #387 follow-up). OFFLINE tooling — not a
// runtime path.
//
// The canon/weather AI pipeline only loosely centres its subject: each
// background-removed icon ends up at its own scale and offset inside the 128px
// square (measured: subject fills anywhere from ~48% to ~75% of the frame, with
// 16–33px asymmetric margins). A set rendered at one fixed box therefore looks
// mismatched — different apparent sizes, different padding.
//
// This trims an icon to its alpha bounding box, scales that box so its LONGER
// side is `contentMax`, and re-pads it dead-centre in a `frame`×`frame`
// transparent square. Every icon then shares the same bounding size and uniform
// margins, so the set reads as one family. It does NOT touch stroke weight or
// palette — those are intrinsic to the generated art.
//
// Pure over a buffer: encoded (WebP/PNG/…) bytes in, `frame`px WebP-with-alpha
// out. Mirrors removeFlatBackground's output (128px, alphaQuality 100).

import sharp from 'sharp';

const FRAME = 128; // output square edge, matches removeFlatBackground's TARGET_SIZE
const CONTENT_MAX = 92; // subject's longer side after normalising (~72% of FRAME → ~18px margins)
const ALPHA_THRESHOLD = 16; // alpha <= this counts as transparent when finding the bbox

const WEBP = { quality: 90, alphaQuality: 100, effort: 6 };

/**
 * @param {Buffer} input encoded image bytes (any sharp-readable format).
 * @param {{ frame?: number, contentMax?: number }} [opts]
 * @returns {Promise<Buffer>} normalised `frame`px square WebP with alpha.
 */
export async function normalizeIconFraming(input, { frame = FRAME, contentMax = CONTENT_MAX } = {}) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels } = info;

  // Alpha bounding box of the subject.
  let minX = W;
  let minY = H;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * channels + 3] > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Fully transparent / blank: nothing to frame — re-encode the square as-is.
  if (maxX < minX || maxY < minY) {
    return sharp(data, { raw: { width: W, height: H, channels } })
      .resize(frame, frame, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp(WEBP)
      .toBuffer();
  }

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const scale = contentMax / Math.max(bw, bh);
  const tw = Math.max(1, Math.round(bw * scale));
  const th = Math.max(1, Math.round(bh * scale));
  const left = Math.round((frame - tw) / 2);
  const top = Math.round((frame - th) / 2);

  // Crop to the subject → scale its longer side to contentMax (aspect kept, so
  // `fill` doesn't distort) → centre it in a transparent frame×frame square.
  return sharp(data, { raw: { width: W, height: H, channels } })
    .extract({ left: minX, top: minY, width: bw, height: bh })
    .resize(tw, th, { fit: 'fill' })
    .extend({
      top,
      bottom: frame - th - top,
      left,
      right: frame - tw - left,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp(WEBP)
    .toBuffer();
}
