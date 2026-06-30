// One-off framing normaliser for the committed weather icons (issue #387
// follow-up). OFFLINE — re-frames the EXISTING committed WebP assets in place
// WITHOUT any AI regeneration, so the 17-icon set reads as one size with
// uniform margins (see scripts/lib/normalizeIconFraming.mjs for the why/how).
//
// Run from the cloud-functions package dir (plain node — no tsx, no API key):
//
//   cd apps/cloud-functions
//   node scripts/normalize-weather-icons.mjs            # all committed *.webp
//   node scripts/normalize-weather-icons.mjs clear-day  # a subset of ids
//
// Idempotent: a second run finds the subject already at contentMax and is a
// no-op on framing (re-encode only). The generator applies the same step, so
// freshly-generated icons need no separate pass.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { normalizeIconFraming } from './lib/normalizeIconFraming.mjs';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// apps/cloud-functions → apps/web-pwa/src/lib/weather-icons
const DIR = resolve(pkgRoot, '../web-pwa/src/lib/weather-icons');

async function main() {
  const args = process.argv.slice(2);
  const all = (await readdir(DIR)).filter((f) => f.endsWith('.webp')).sort();
  const targets = args.length ? args.map((a) => `${a.replace(/\.webp$/, '')}.webp`) : all;

  const missing = targets.filter((t) => !all.includes(t));
  if (missing.length) {
    throw new Error(`normalize-weather-icons: no such asset(s): ${missing.join(', ')}`);
  }

  console.log(`normalize-weather-icons: dir → ${DIR}`);
  for (const file of targets) {
    const p = resolve(DIR, file);
    const before = await readFile(p);
    const after = await normalizeIconFraming(before);
    await writeFile(p, after);
    console.log(`  ✓ ${file} (${before.length} → ${after.length} bytes)`);
  }
  console.log(`normalize-weather-icons: done — ${targets.length} icon(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
