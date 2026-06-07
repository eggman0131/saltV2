import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { removeFlatBackground } from '../../src/imaging/removeFlatBackground.js';

// Builds a fixture matching the house style: a flat off-white background with a
// solid, dark-outlined subject centred and not touching the frame edge — the
// exact precondition the edge-seeded flood fill relies on.
async function makeFixture(size = 64): Promise<Buffer> {
  const channels = 4;
  const data = Buffer.alloc(size * size * channels);
  const bg = { r: 250, g: 249, b: 244 }; // off-white flat fill
  const subject = { r: 40, g: 90, b: 200 }; // a solid blue blob
  const lo = Math.floor(size * 0.3);
  const hi = Math.floor(size * 0.7);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = (y * size + x) * channels;
      const inSubject = x >= lo && x < hi && y >= lo && y < hi;
      const c = inSubject ? subject : bg;
      data[p] = c.r;
      data[p + 1] = c.g;
      data[p + 2] = c.b;
      data[p + 3] = 255;
    }
  }
  return sharp(data, { raw: { width: size, height: size, channels } })
    .png()
    .toBuffer();
}

async function readPixels(buf: Buffer): Promise<{
  data: Buffer;
  width: number;
  height: number;
  channels: number;
}> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

describe('removeFlatBackground', () => {
  it('produces a 128px square WebP with an alpha channel', async () => {
    const out = await removeFlatBackground(await makeFixture());
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(128);
    expect(meta.height).toBe(128);
    expect(meta.hasAlpha).toBe(true);
  });

  it('honours a custom output size', async () => {
    const out = await removeFlatBackground(await makeFixture(), { size: 64 });
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(64);
    expect(meta.height).toBe(64);
  });

  it('makes the background transparent and keeps the subject opaque', async () => {
    const out = await removeFlatBackground(await makeFixture());
    const { data, width, height, channels } = await readPixels(out);

    // Corner pixel (background) → fully transparent.
    const cornerAlpha = data[3]!;
    expect(cornerAlpha).toBe(0);

    // Centre pixel (subject) → opaque.
    const cx = Math.floor(width / 2);
    const cy = Math.floor(height / 2);
    const centreAlpha = data[(cy * width + cx) * channels + 3]!;
    expect(centreAlpha).toBeGreaterThan(200);
  });
});
