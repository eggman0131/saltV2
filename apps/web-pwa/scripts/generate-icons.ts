// Generates the PWA icon set from the single master SVG (issue #141, Phase 2).
//
// Source of truth: branding/icon-master.svg (1024×1024, opaque/full-bleed, with
// the glyph inside the central 80% safe zone). Because the master is full-bleed
// and safe-zone-aware, the same raster serves both `any` and `maskable` purposes
// — no second master is needed.
//
// One VARIANT per non-production environment: a dev/staging install gets its icon
// in that environment's TopBar colour (BANNERS in src/lib/environment.ts), so a
// home screen holding several Salts is unambiguous at a glance — the same reason
// each env already installs under its own name and theme colour. The master keeps
// the PRODUCTION palette and each variant re-colours it by targeted string
// substitution, so the master stays a valid standalone SVG (no placeholder
// tokens). A substitution that matches nothing THROWS: a renamed colour literal
// must fail the run loudly rather than quietly emit prod-orange dev icons.
//
// Emits three kinds of asset from that one master:
//   • app icons (192/512 + apple-touch 180) — the installed home-screen/launcher icon
//   • favicon.svg + favicon-32.png — the browser tab, per environment, tightly framed
//   • badge-96.png — the monochrome notification badge, shared by all environments
//
// Run with:  pnpm --filter @salt/web-pwa icons:generate
// The emitted files live in public/icons/ (production) and public/icons/<env>/, and
// are committed; the production build does not depend on sharp.

import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, '..');
const master = resolve(appRoot, 'branding/icon-master.svg');
const outRoot = resolve(appRoot, 'public/icons');

// The colour literals the master is authored with. Substitution is anchored to the
// full attribute (`stroke="…"`, not the bare hex) because the master's white glow
// gradient ALSO uses #FFFFFF stops — only the glyph stroke may be re-coloured.
const MASTER_GRADIENT_FROM = '#FB923C'; // orange-400
const MASTER_GRADIENT_TO = '#EA580C'; // orange-600
const MASTER_GLYPH = '#FFFFFF';
// Background/glow fills, dropped for the transparent notification badge.
const MASTER_BG_FILL = 'fill="url(#bg)"';
const MASTER_GLOW_FILL = 'fill="url(#glow)"';

// Tight framing for the small renders. The master sizes its glyph at ~47% of the
// canvas so it clears the maskable safe zone — correct for a 192 px launcher icon,
// but a hairline at 16 px. Cropping the VIEWBOX to the central 70% (the safe zone is
// 80%, so nothing is clipped, stroke included) lifts the glyph to ~67% of the frame
// and keeps it legible in a browser tab and in the status bar.
const MASTER_VIEWBOX = 'viewBox="0 0 1024 1024"';
const CROPPED_VIEWBOX = 'viewBox="154 154 716 716"';

interface Variant {
  /** Output subdirectory under public/icons; '' is production (the master palette). */
  dir: string;
  /** Top gradient stop — two Tailwind shades lighter than `to`, as in the master. */
  from: string;
  /** Bottom gradient stop — the environment's TopBar BACKGROUND colour. */
  to: string;
  /** Glyph stroke — the environment's TopBar FOREGROUND colour. */
  glyph: string;
}

// `to`/`glyph` are lifted verbatim from the TopBar classes in
// src/lib/environment.ts, so the installed icon reads as the same colour as the
// bar at the top of the app. Keep these in sync if a banner colour changes.
const variants: readonly Variant[] = [
  // production — no banner; the brand orange the master is authored in.
  { dir: '', from: MASTER_GRADIENT_FROM, to: MASTER_GRADIENT_TO, glyph: MASTER_GLYPH },
  // dev (s2-dev-eggman) — bg-violet-600 / text-white.
  { dir: 'dev', from: '#A78BFA', to: '#7C3AED', glyph: '#FFFFFF' },
  // staging (s2-stage-ccb22) — bg-amber-500 / text-amber-950. Amber is light, so
  // the glyph goes DARK here exactly as the bar's own text does.
  { dir: 'staging', from: '#FCD34D', to: '#F59E0B', glyph: '#451A03' },
];

// size -> output filename. Maskable variants reuse the full-bleed render (the
// manifest tags them purpose: "maskable"); apple-touch-icon is opaque 180.
const targets: ReadonlyArray<{ size: number; file: string }> = [
  { size: 192, file: 'icon-192.png' },
  { size: 512, file: 'icon-512.png' },
  { size: 180, file: 'apple-touch-icon-180.png' },
];

// Browser-tab icon: the SVG is primary (crisp at every size) and the small PNG is the
// fallback for engines that don't accept an SVG favicon.
const FAVICON_PNG_SIZE = 32;
// Notification badge (the small status-bar mark, not the large icon). Android renders
// it from the ALPHA CHANNEL ONLY, so it has to be a transparent-background monochrome
// glyph — passing the opaque app icon yields a solid grey blob. One shared file:
// monochrome by construction, so there is nothing env-specific to vary.
const BADGE_SIZE = 96;

type Substitution = readonly [needle: string, replacement: string];

// Applies each substitution, throwing if one matches nothing: a renamed literal in the
// master must fail the run loudly, not silently emit a prod-orange dev icon or an
// invisible badge.
function substitute(svg: string, substitutions: readonly Substitution[]): string {
  return substitutions.reduce((acc, [needle, replacement]) => {
    if (!acc.includes(needle)) {
      throw new Error(
        `branding/icon-master.svg no longer contains ${needle} — this derived asset ` +
          `cannot be built. Update the MASTER_* constants in this script.`,
      );
    }
    return acc.replaceAll(needle, replacement);
  }, svg);
}

// Full-bleed launcher/home-screen icon in the environment's colours.
function appIconSvg(svg: string, variant: Variant): string {
  return substitute(svg, [
    [`stop-color="${MASTER_GRADIENT_FROM}"`, `stop-color="${variant.from}"`],
    [`stop-color="${MASTER_GRADIENT_TO}"`, `stop-color="${variant.to}"`],
    [`stroke="${MASTER_GLYPH}"`, `stroke="${variant.glyph}"`],
  ]);
}

// Same colours as the app icon, framed tighter so it survives a 16 px browser tab.
function faviconSvg(svg: string, variant: Variant): string {
  return substitute(appIconSvg(svg, variant), [[MASTER_VIEWBOX, CROPPED_VIEWBOX]]);
}

// Transparent, white, tightly framed — the shape Android's status bar can tint.
function badgeSvg(svg: string): string {
  return substitute(svg, [
    [MASTER_VIEWBOX, CROPPED_VIEWBOX],
    [MASTER_BG_FILL, 'fill="none"'],
    [MASTER_GLOW_FILL, 'fill="none"'],
    // Identity today (the master's glyph is already white), kept for the guard: a
    // master that stops using white must fail rather than ship an invisible badge.
    [`stroke="${MASTER_GLYPH}"`, `stroke="${MASTER_GLYPH}"`],
  ]);
}

async function main(): Promise<void> {
  const svg = await readFile(master, 'utf8');
  for (const variant of variants) {
    const outDir = resolve(outRoot, variant.dir);
    const label = variant.dir ? `${variant.dir}/` : '';
    await mkdir(outDir, { recursive: true });

    const iconSource = Buffer.from(appIconSvg(svg, variant));
    for (const { size, file } of targets) {
      await sharp(iconSource)
        .resize(size, size, { fit: 'cover' })
        .png()
        .toFile(resolve(outDir, file));
      console.log(`wrote public/icons/${label}${file} (${size}×${size})`);
    }

    // The favicon SVG ships as-is AND is the source the PNG fallback is rasterised
    // from, so the vector and the raster can never disagree.
    const favicon = faviconSvg(svg, variant);
    await writeFile(resolve(outDir, 'favicon.svg'), favicon, 'utf8');
    console.log(`wrote public/icons/${label}favicon.svg (vector)`);
    await sharp(Buffer.from(favicon))
      .resize(FAVICON_PNG_SIZE, FAVICON_PNG_SIZE, { fit: 'cover' })
      .png()
      .toFile(resolve(outDir, `favicon-${FAVICON_PNG_SIZE}.png`));
    console.log(
      `wrote public/icons/${label}favicon-${FAVICON_PNG_SIZE}.png ` +
        `(${FAVICON_PNG_SIZE}×${FAVICON_PNG_SIZE})`,
    );
  }

  // One shared notification badge for every environment (see BADGE_SIZE).
  await sharp(Buffer.from(badgeSvg(svg)))
    .resize(BADGE_SIZE, BADGE_SIZE, { fit: 'cover' })
    .png()
    .toFile(resolve(outRoot, `badge-${BADGE_SIZE}.png`));
  console.log(
    `wrote public/icons/badge-${BADGE_SIZE}.png (${BADGE_SIZE}×${BADGE_SIZE}, monochrome)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
