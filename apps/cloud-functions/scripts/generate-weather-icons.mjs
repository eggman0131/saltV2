// One-off weather-icon generator (issue #387).
//
// Generates the FIXED set of 17 weather pictograms by REUSING the existing
// canon-icon AI pipeline: same Gemini image model (resolved the same way), the
// same committed canon-icon seed as reference-conditioning media, the same
// withAiTimeout wrapper, and the same removeFlatBackground post-process. The
// only weather-specific part is the prompt text (buildWeatherIconPrompt).
//
// This is an OFFLINE, manual one-off — NOT a runtime path. The planner renders
// the committed static WebP assets it writes; nothing calls this at request
// time. It writes 128px WebP-with-alpha files to:
//     apps/web-pwa/src/lib/weather-icons/<iconId>.webp
//
// ── HOW TO RUN ────────────────────────────────────────────────────────────
// This .mjs imports TypeScript modules from src/ directly, so it MUST be run
// under tsx (no build step needed; tsx is a devDependency of this package).
// GEMINI_API_KEY is read from process.env — load it from .secret.local via
// tsx's --env-file. Run from the cloud-functions package dir:
//
//   cd apps/cloud-functions
//
//   # 2–3 sample ids first (recommended — eyeball the house style):
//   npx tsx --env-file=.secret.local scripts/generate-weather-icons.mjs \
//     clear-day rain-heavy thunder
//
//   # the full set of 17 (no args = all):
//   npx tsx --env-file=.secret.local scripts/generate-weather-icons.mjs
//
// (`pnpm --filter @salt/cloud-functions exec tsx --env-file=.secret.local \
//   scripts/generate-weather-icons.mjs [ids...]` works from the repo root.)
//
// Subset mode: any ids passed as CLI args are generated instead of all 17; an
// unknown id is rejected with the valid list. The script overwrites existing
// files and creates the output dir if missing.
// ────────────────────────────────────────────────────────────────────────────

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { googleAI } from '@genkit-ai/google-genai';

// Reused, NOT reimplemented: the genkit `ai` instance, the model resolver, the
// AI-timeout wrapper, the committed seed loader, the background remover, and the
// weather prompt builder + the canonical 17-id list.
import { ai } from '../src/genkit.js';
import { resolveModel } from '../src/ai/resolveModel.js';
import { withAiTimeout } from '../src/adapters/withAiTimeout.js';
import { loadCanonIconSeed } from '../src/flows/assets/canonIconSeed.js';
import { removeFlatBackground } from '../src/imaging/removeFlatBackground.js';
import {
  buildWeatherIconPrompt,
  WEATHER_ICON_IDS,
} from '../src/flows/weatherIconPrompt.js';

// Match the canon flow's image-generation deadline (its function timeout is
// raised to suit; here there is no function, but reuse the same budget/retry).
const ICON_GEN_TIMEOUT_MS = 60_000;

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// apps/cloud-functions → apps/web-pwa/src/lib/weather-icons
const OUTPUT_DIR = resolve(pkgRoot, '../web-pwa/src/lib/weather-icons');

function parseDataUrl(url) {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(url);
  if (!match) {
    throw new Error('generate-weather-icons: model media is not a base64 data URI');
  }
  return { contentType: match[1], base64: match[2] };
}

/** Resolve the requested id set from CLI args; no args = all 17. */
function selectIds(args) {
  if (args.length === 0) return WEATHER_ICON_IDS;
  const valid = new Set(WEATHER_ICON_IDS);
  const unknown = args.filter((id) => !valid.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown weather icon id(s): ${unknown.join(', ')}\n` +
        `Valid ids: ${WEATHER_ICON_IDS.join(', ')}`,
    );
  }
  return args;
}

/** Generate one icon: prompt → model → background-removed 128px WebP buffer. */
async function generateOne(iconId, seed, imageModel) {
  const result = await withAiTimeout(
    `generate-weather-icon:${iconId}`,
    () =>
      ai.generate({
        model: imageModel,
        prompt: [
          { media: { url: seed.url, contentType: seed.contentType } },
          { text: buildWeatherIconPrompt(iconId) },
        ],
      }),
    { timeoutMs: ICON_GEN_TIMEOUT_MS, retries: 1 },
  );

  const media = result.media;
  if (!media?.url) {
    throw new Error(`generate-weather-icons: model returned no image for ${iconId}`);
  }

  const { base64 } = parseDataUrl(media.url);
  const raw = Buffer.from(base64, 'base64');
  // EXISTING post-process: flood-fill the flat background to transparent and
  // emit a 128px square WebP with alpha (same as the canon trigger).
  return removeFlatBackground(raw);
}

async function main() {
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
    throw new Error(
      'generate-weather-icons: GEMINI_API_KEY (or GOOGLE_API_KEY) is not set. ' +
        'Run under tsx with --env-file=.secret.local.',
    );
  }

  const ids = selectIds(process.argv.slice(2));

  console.log(`generate-weather-icons: output dir → ${OUTPUT_DIR}`);
  console.log(
    `generate-weather-icons: generating ${ids.length} of ${WEATHER_ICON_IDS.length} icon(s):`,
  );
  for (const id of ids) console.log(`  - ${id} → ${id}.webp`);

  await mkdir(OUTPUT_DIR, { recursive: true });

  // Resolve the model + load the seed once (the canon flow resolves per call,
  // but for a batch one-off a single resolution is fine and cheaper).
  const modelId = await resolveModel('image', 'generateCanonIcon');
  console.log(`generate-weather-icons: using image model "${modelId}"`);
  const imageModel = googleAI.model(modelId);
  const seed = loadCanonIconSeed();

  let ok = 0;
  const failures = [];
  for (const iconId of ids) {
    const startedAt = Date.now();
    try {
      const webp = await generateOne(iconId, seed, imageModel);
      const outPath = resolve(OUTPUT_DIR, `${iconId}.webp`);
      await writeFile(outPath, webp);
      ok += 1;
      console.log(
        `  ✓ ${iconId} (${webp.length} bytes, ${Date.now() - startedAt}ms) → ${outPath}`,
      );
    } catch (err) {
      failures.push(iconId);
      console.error(`  ✗ ${iconId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`generate-weather-icons: done — ${ok} ok, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error(`generate-weather-icons: failed ids: ${failures.join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
