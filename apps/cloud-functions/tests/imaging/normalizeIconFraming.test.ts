import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { normalizeIconFraming } from '../../src/imaging/normalizeIconFraming.js';

// Builds a transparent square with an opaque blob at a given scale and offset —
// i.e. what removeFlatBackground hands over: a subject somewhere inside a 128px
// frame, at whatever size the model happened to draw it.
async function makeIcon({
  size = 128,
  boxW,
  boxH,
  left,
  top,
}: {
  size?: number;
  boxW: number;
  boxH: number;
  left: number;
  top: number;
}): Promise<Buffer> {
  const channels = 4;
  const data = Buffer.alloc(size * size * channels); // all-zero = transparent
  for (let y = top; y < top + boxH; y++) {
    for (let x = left; x < left + boxW; x++) {
      const p = (y * size + x) * channels;
      data[p] = 30;
      data[p + 1] = 120;
      data[p + 2] = 60;
      data[p + 3] = 255;
    }
  }
  return sharp(data, { raw: { width: size, height: size, channels } })
    .webp()
    .toBuffer();
}

/** Alpha bounding box of the subject, the same measure the normaliser uses. */
async function bbox(buf: Buffer): Promise<{
  w: number;
  h: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  frame: number;
}> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3]! > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return {
    w: maxX - minX + 1,
    h: maxY - minY + 1,
    left: minX,
    right: width - 1 - maxX,
    top: minY,
    bottom: height - 1 - maxY,
    frame: width,
  };
}

describe('normalizeIconFraming', () => {
  it('scales a small subject up to contentMax on its longer side', async () => {
    // 40px subject in a 128px frame — the under-filled case measured on real
    // production icons (Baby Spinach fills 55% of its frame).
    const icon = await makeIcon({ boxW: 40, boxH: 30, left: 20, top: 60 });
    const out = await normalizeIconFraming(icon, { contentMax: 108 });
    const b = await bbox(out);
    expect(b.frame).toBe(128);
    // Longer side lands on contentMax (±1px for rounding), aspect preserved.
    expect(b.w).toBeGreaterThanOrEqual(107);
    expect(b.w).toBeLessThanOrEqual(109);
    expect(b.h / b.w).toBeCloseTo(30 / 40, 1);
  });

  it('scales an over-large subject down to contentMax', async () => {
    const icon = await makeIcon({ boxW: 124, boxH: 100, left: 2, top: 14 });
    const b = await bbox(await normalizeIconFraming(icon, { contentMax: 108 }));
    expect(b.w).toBeGreaterThanOrEqual(107);
    expect(b.w).toBeLessThanOrEqual(109);
  });

  it('centres the subject, so an off-centre original comes back with even margins', async () => {
    // Hard against the left edge and low in the frame.
    const icon = await makeIcon({ boxW: 50, boxH: 50, left: 0, top: 70 });
    const b = await bbox(await normalizeIconFraming(icon, { contentMax: 108 }));
    expect(Math.abs(b.left - b.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.top - b.bottom)).toBeLessThanOrEqual(1);
  });

  it('gives differently-framed icons the SAME bounding size (the point of the pass)', async () => {
    const a = await makeIcon({ boxW: 64, boxH: 70, left: 32, top: 29 }); // 55% fill
    const c = await makeIcon({ boxW: 92, boxH: 75, left: 18, top: 27 }); // 72% fill
    const [ba, bc] = await Promise.all([
      bbox(await normalizeIconFraming(a, { contentMax: 108 })),
      bbox(await normalizeIconFraming(c, { contentMax: 108 })),
    ]);
    expect(Math.max(ba.w, ba.h)).toBe(Math.max(bc.w, bc.h));
  });

  it('leaves the margin the match-reveal sage needs to read', async () => {
    // ui-spec-v04 §14.5.3: the sage lift shows around and through the artwork.
    // At contentMax 108 the subject stops ~10px short of the frame on its long
    // axis, so the backdrop is never fully covered.
    const icon = await makeIcon({ boxW: 100, boxH: 100, left: 14, top: 14 });
    const b = await bbox(await normalizeIconFraming(icon, { contentMax: 108 }));
    expect(b.left).toBeGreaterThan(0);
    expect(b.top).toBeGreaterThan(0);
  });

  it('is idempotent — a second pass is a no-op on framing', async () => {
    const once = await normalizeIconFraming(
      await makeIcon({ boxW: 40, boxH: 30, left: 20, top: 60 }),
      { contentMax: 108 },
    );
    const twice = await normalizeIconFraming(once, { contentMax: 108 });
    const [b1, b2] = await Promise.all([bbox(once), bbox(twice)]);
    expect(b2.w).toBe(b1.w);
    expect(b2.h).toBe(b1.h);
  });

  it('defaults to the 92px weather framing when contentMax is omitted', async () => {
    const b = await bbox(
      await normalizeIconFraming(await makeIcon({ boxW: 40, boxH: 40, left: 44, top: 44 })),
    );
    expect(Math.max(b.w, b.h)).toBeGreaterThanOrEqual(91);
    expect(Math.max(b.w, b.h)).toBeLessThanOrEqual(93);
  });

  it('re-encodes a fully transparent icon instead of throwing', async () => {
    const blank = await sharp({
      create: { width: 128, height: 128, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .webp()
      .toBuffer();
    const out = await normalizeIconFraming(blank, { contentMax: 108 });
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(128);
    expect(meta.height).toBe(128);
  });

  it('emits a square WebP with an alpha channel', async () => {
    const out = await normalizeIconFraming(
      await makeIcon({ boxW: 50, boxH: 50, left: 39, top: 39 }),
      { contentMax: 108 },
    );
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(128);
    expect(meta.height).toBe(128);
    expect(meta.hasAlpha).toBe(true);
  });
});
