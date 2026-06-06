// Generates the PWA icon set from the single master SVG (issue #141, Phase 2).
//
// Source of truth: branding/icon-master.svg (1024×1024, opaque/full-bleed, with
// the glyph inside the central 80% safe zone). Because the master is full-bleed
// and safe-zone-aware, the same raster serves both `any` and `maskable` purposes
// — no second master is needed.
//
// Run with:  pnpm --filter @salt/web-pwa icons:generate
// The emitted PNGs live in public/icons/ and are committed; the production build
// does not depend on sharp.

import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, '..');
const master = resolve(appRoot, 'branding/icon-master.svg');
const outDir = resolve(appRoot, 'public/icons');

// size -> output filename. Maskable variants reuse the full-bleed render (the
// manifest tags them purpose: "maskable"); apple-touch-icon is opaque 180.
const targets: ReadonlyArray<{ size: number; file: string }> = [
  { size: 192, file: 'icon-192.png' },
  { size: 512, file: 'icon-512.png' },
  { size: 180, file: 'apple-touch-icon-180.png' },
];

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  for (const { size, file } of targets) {
    await sharp(master).resize(size, size, { fit: 'cover' }).png().toFile(resolve(outDir, file));
    console.log(`wrote public/icons/${file} (${size}×${size})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
