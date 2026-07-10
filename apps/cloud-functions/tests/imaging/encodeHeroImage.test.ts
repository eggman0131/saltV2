import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { encodeHeroImage } from '../../src/imaging/encodeHeroImage.js';

// A plain photographic-ish fixture: a solid rectangle at a given size, encoded as
// PNG. encodeHeroImage should re-encode to bounded WebP without cropping.
async function makeFixture(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 180, g: 120, b: 80 } },
  })
    .png()
    .toBuffer();
}

describe('encodeHeroImage', () => {
  it('re-encodes to WebP', async () => {
    const out = await encodeHeroImage(await makeFixture(800, 600));
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('webp');
  });

  it('bounds the longest edge to 1280 while preserving aspect ratio', async () => {
    const out = await encodeHeroImage(await makeFixture(2400, 1600)); // 3:2, oversized
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(1280);
    expect(meta.height).toBe(853); // 1280 * (1600/2400), rounded
  });

  it('honours a custom maxEdge', async () => {
    const out = await encodeHeroImage(await makeFixture(2000, 2000), { maxEdge: 512 });
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(512);
  });

  it('never upscales a small image', async () => {
    const out = await encodeHeroImage(await makeFixture(400, 300));
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(300);
  });

  it('does not add an alpha channel (it is a photo, not a pictogram)', async () => {
    const out = await encodeHeroImage(await makeFixture(800, 600));
    const meta = await sharp(out).metadata();
    expect(meta.hasAlpha).toBe(false);
  });
});
