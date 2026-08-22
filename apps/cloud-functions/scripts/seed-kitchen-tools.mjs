// Offline kitchen-tool pictogram generator + seeder (issue #882, Phase 1).
//
// WHY THIS EXISTS — the vocabulary is CURATED, not discovered. Canon items are
// minted on demand because an ingredient nobody has seen before still has to go
// on a shopping list; a kitchen tool has no such obligation. A name that matches
// nothing renders as words with no picture, which is the correct and complete
// answer to a miss. So the list of tools is a table a person wrote, and this
// script is how that table becomes forty documents and forty drawings.
//
// It is also the art direction being JUDGED before anything depends on it. Run
// with no flags it writes nothing but local files, and `index.html` shows the
// whole set side by side — because "do these forty read as one kit" is not a
// question you can answer one file at a time in a Finder window. Iterating a
// prompt through a deployed Firestore trigger is slow and expensive; iterating it
// here costs one image.
//
// The pipeline it exercises is the one the app runs, in the same order, REUSED
// rather than reimplemented:
//
//   generateKitchenToolIcon    (image tier, seed-conditioned)
//   removeFlatBackground                            → 128px WebP with alpha
//   normalizeIconFraming({ contentMax: 108 })       → canon framing, tuned for
//                                                     the small tile
//
// ── THE VOCABULARY ────────────────────────────────────────────────────────
// `TOOLS` below is the Phase-1 list, and it is the deliverable as much as the
// code is. It was grounded by reading staging's real `guidedPlans`: the container
// words actually in use are "Magmix bowl", "meat plate" and "serving plate", with
// step `setup` fields naming a bowl, a work surface, a wire cooling rack, a tin, a
// pan and a hob burner. Two plans is a thin sample, so the list is that evidence
// plus an obvious core of what a home kitchen contains. It is meant to be grown:
// nothing stores a tool id, so adding "griddle pan" later gives every plan that
// already says it a picture, retroactively and for free.
//
// Ids are kebab-case of the label, which is what makes `kit-icons/{id}.webp`
// predictable and lets the weekly orphan sweep join the two.
//
// ── HOW TO RUN ────────────────────────────────────────────────────────────
// This .mjs imports TypeScript modules from src/ directly, so it MUST be run
// under tsx. Two credentials are needed:
//   • GEMINI_API_KEY — from .secret.local, loaded via tsx's --env-file
//   • application-default credentials for the target project
//     (`gcloud auth application-default login`)
// Run from the cloud-functions package dir:
//
//   cd apps/cloud-functions
//
//   # one or two tools (eyeball the house style before the full set):
//   GOOGLE_CLOUD_PROJECT=s2-stage-ccb22 npx tsx --env-file=.secret.local \
//     scripts/seed-kitchen-tools.mjs whisk mixing-bowl
//
//   # the whole vocabulary (no id args = every tool), still local-only:
//   GOOGLE_CLOUD_PROJECT=s2-stage-ccb22 npx tsx --env-file=.secret.local \
//     scripts/seed-kitchen-tools.mjs
//
//   # the seeding run: upload + write the kitchenTools docs as well
//   GOOGLE_CLOUD_PROJECT=s2-stage-ccb22 npx tsx --env-file=.secret.local \
//     scripts/seed-kitchen-tools.mjs --apply
//
// Subset args match a tool id exactly (ids are readable, so nobody needs a
// substring search). An arg that matches nothing is rejected with the full list.
// Existing files are overwritten; the output dir is created if missing.
//
// Output → apps/cloud-functions/.kitchen-tools.local/
//   <id>.webp   the pictogram
//   index.html  contact sheet: the whole set side by side
// (`.local` is gitignored repo-wide, so nothing here is ever committed.)
// ────────────────────────────────────────────────────────────────────────────

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

// Reused, NOT reimplemented: the flow the trigger runs, and the two imaging steps
// the canon pipeline runs after it.
import { generateKitchenToolIconFlow } from '../src/flows/generateKitchenToolIcon.js';
import { removeFlatBackground } from '../src/imaging/removeFlatBackground.js';
import { normalizeIconFraming } from '../src/imaging/normalizeIconFraming.js';
import { buildStorageDownloadUrl } from '../src/imaging/storageDownloadUrl.js';
import { KITCHEN_TOOLS_COLLECTION } from '@salt/domain/schemas';

// The canon framing value, tuned for the small row tile (onCanonItemWritten.ts).
const CONTENT_MAX = 108;

// The curated vocabulary. `matchers` are EXTRA phrasings only — the label is
// matched on equal terms by `resolveKitchenTool`, so no tool repeats its own
// name here. Longest normalised phrase wins, which is what lets "small bowl"
// beat "bowl" and "frying pan" beat "pan"; keep that in mind before adding a
// short matcher to a tool that a longer one already covers.
const TOOLS = [
  { id: 'mixing-bowl', label: 'Mixing bowl', matchers: ['bowl', 'large bowl', 'big bowl', 'batter bowl'] },
  { id: 'small-bowl', label: 'Small bowl', matchers: ['ramekin', 'prep bowl', 'little bowl'] },
  { id: 'jug', label: 'Jug', matchers: ['measuring jug', 'pouring jug', 'pitcher'] },
  { id: 'plate', label: 'Plate', matchers: ['serving plate', 'meat plate', 'dinner plate', 'dish', 'platter'] },
  { id: 'baking-tray', label: 'Baking tray', matchers: ['tray', 'oven tray', 'baking sheet', 'sheet pan', 'roasting tray'] },
  { id: 'roasting-tin', label: 'Roasting tin', matchers: ['roasting dish', 'roasting pan'] },
  { id: 'loaf-tin', label: 'Loaf tin', matchers: ['bread tin', 'loaf pan'] },
  { id: 'cake-tin', label: 'Cake tin', matchers: ['cake pan', 'springform tin', 'sandwich tin'] },
  { id: 'ovenproof-dish', label: 'Ovenproof dish', matchers: ['baking dish', 'casserole dish', 'gratin dish', 'oven dish'] },
  { id: 'colander', label: 'Colander', matchers: ['strainer', 'pasta strainer'] },
  { id: 'sieve', label: 'Sieve', matchers: ['fine sieve', 'fine mesh sieve', 'sifter', 'mesh strainer'] },
  { id: 'frying-pan', label: 'Frying pan', matchers: ['skillet', 'large frying pan', 'small frying pan', 'non-stick pan', 'saute pan', 'sauté pan'] },
  { id: 'saucepan', label: 'Saucepan', matchers: ['pan', 'small saucepan', 'large saucepan', 'milk pan'] },
  { id: 'stockpot', label: 'Stockpot', matchers: ['pot', 'large pot', 'big pot', 'pasta pot'] },
  { id: 'casserole-pot', label: 'Casserole pot', matchers: ['dutch oven', 'casserole', 'heavy-based pot', 'cast iron pot'] },
  { id: 'griddle-pan', label: 'Griddle pan', matchers: ['grill pan'] },
  { id: 'wok', label: 'Wok', matchers: ['stir-fry pan'] },
  { id: 'chopping-board', label: 'Chopping board', matchers: ['cutting board', 'board'] },
  { id: 'chefs-knife', label: "Chef's knife", matchers: ["cook's knife", 'large knife', 'sharp knife', 'knife'] },
  { id: 'paring-knife', label: 'Paring knife', matchers: ['small knife'] },
  { id: 'bread-knife', label: 'Bread knife', matchers: ['serrated knife'] },
  { id: 'wooden-spoon', label: 'Wooden spoon', matchers: ['spoon'] },
  { id: 'spatula', label: 'Spatula', matchers: ['fish slice', 'turner', 'silicone spatula'] },
  { id: 'whisk', label: 'Whisk', matchers: ['balloon whisk', 'hand whisk'] },
  { id: 'tongs', label: 'Tongs', matchers: [] },
  { id: 'ladle', label: 'Ladle', matchers: [] },
  { id: 'slotted-spoon', label: 'Slotted spoon', matchers: [] },
  { id: 'box-grater', label: 'Box grater', matchers: ['grater', 'cheese grater'] },
  { id: 'microplane', label: 'Microplane', matchers: ['fine grater', 'zester'] },
  { id: 'peeler', label: 'Peeler', matchers: ['vegetable peeler', 'potato peeler', 'y peeler'] },
  { id: 'potato-masher', label: 'Potato masher', matchers: ['masher'] },
  { id: 'rolling-pin', label: 'Rolling pin', matchers: [] },
  { id: 'pastry-brush', label: 'Pastry brush', matchers: ['basting brush'] },
  { id: 'tin-opener', label: 'Tin opener', matchers: ['can opener'] },
  { id: 'garlic-crusher', label: 'Garlic crusher', matchers: ['garlic press'] },
  { id: 'kitchen-scales', label: 'Kitchen scales', matchers: ['scales', 'digital scales'] },
  { id: 'wire-rack', label: 'Wire rack', matchers: ['cooling rack', 'wire cooling rack', 'rack'] },
  { id: 'mortar-and-pestle', label: 'Mortar and pestle', matchers: ['pestle and mortar', 'mortar'] },
  { id: 'kitchen-scissors', label: 'Kitchen scissors', matchers: ['scissors', 'kitchen shears', 'shears'] },
  { id: 'thermometer', label: 'Thermometer', matchers: ['meat thermometer', 'probe thermometer', 'digital thermometer'] },
];

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = resolve(pkgRoot, '.kitchen-tools.local');

const apply = process.argv.includes('--apply');
const selectors = process.argv.slice(2).filter((a) => !a.startsWith('--'));

// The default bucket is derived from FIREBASE_CONFIG inside the CF runtime, which
// a standalone script has no access to — `getStorage().bucket()` would throw
// "Bucket name not specified". Every Salt project uses
// `<project>.firebasestorage.app`; STORAGE_BUCKET overrides it if that ever stops
// holding. (Same derivation as scripts/generate-equipment-icons.mjs.)
const projectId = process.env['GOOGLE_CLOUD_PROJECT'] ?? process.env['GCLOUD_PROJECT'];

/** Narrow the vocabulary to the requested subset; no selectors = every tool. */
function selectTools(args) {
  if (args.length === 0) return TOOLS;
  const wanted = new Set(args.map((a) => a.toLowerCase()));
  const unmatched = args.filter((a) => !TOOLS.some((t) => t.id === a.toLowerCase()));
  if (unmatched.length > 0) {
    throw new Error(
      `Nothing matched: ${unmatched.join(', ')}\nTools in the vocabulary:\n` +
        TOOLS.map((t) => `  ${t.id}  ${t.label}`).join('\n'),
    );
  }
  // Keep table order rather than argument order, so a contact sheet built from a
  // subset reads the same way as one built from the whole set.
  return TOOLS.filter((t) => wanted.has(t.id));
}

/** Escape for interpolation into the contact sheet. */
function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The contact sheet. The whole point of running this without `--apply` is judging
 * the set side by side — a whisk that is fine on its own and wrong beside the
 * ladle is a defect you can only see in a row of forty. Each tile carries the
 * words that resolve to it, because a picture whose matchers are wrong is a
 * different fault from a picture that is wrong.
 */
function contactSheet(rows) {
  const cards = rows
    .map(
      (r) => `  <figure>
    ${r.image ? `<img src="${escapeHtml(r.id)}.webp" alt="${escapeHtml(r.label)}" />` : '<div class="missing">no image</div>'}
    <figcaption>
      <strong>${escapeHtml(r.label)}</strong>
      <p>${escapeHtml(r.matchers.length > 0 ? r.matchers.join(' · ') : '— label only —')}</p>
    </figcaption>
  </figure>`,
    )
    .join('\n');
  return `<!doctype html>
<meta charset="utf-8" />
<title>Kitchen tool pictograms — issue #882 Phase 1</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 2rem; background: #faf8f5; color: #221; }
  h1 { font-size: 1.2rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1.25rem; }
  figure { margin: 0; padding-bottom: 1rem; border-bottom: 1px solid #e5e0d8; }
  img, .missing { width: 128px; height: 128px; background: #f0ece6; border-radius: 12px; }
  .missing { display: grid; place-items: center; font-size: 12px; color: #998; }
  figcaption p { margin: .35rem 0 0; color: #554; font-size: 13px; }
</style>
<h1>Kitchen tool pictograms — ${rows.length} tool(s)</h1>
<div class="grid">
${cards}
</div>
`;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

async function main() {
  if (!projectId) {
    throw new Error(
      'seed-kitchen-tools: set GOOGLE_CLOUD_PROJECT to the target project (e.g. s2-stage-ccb22).',
    );
  }
  if (!process.env['GEMINI_API_KEY'] && !process.env['GOOGLE_API_KEY']) {
    throw new Error(
      'seed-kitchen-tools: GEMINI_API_KEY (or GOOGLE_API_KEY) is not set. ' +
        'Run under tsx with --env-file=.secret.local.',
    );
  }

  const storageBucket = process.env['STORAGE_BUCKET'] ?? `${projectId}.firebasestorage.app`;
  initializeApp({ projectId, credential: applicationDefault(), storageBucket });

  const tools = selectTools(selectors);
  const mode = apply
    ? `APPLY — uploads + writes ${KITCHEN_TOOLS_COLLECTION} docs`
    : 'images, LOCAL ONLY (pass --apply to write)';
  console.log(
    `seed-kitchen-tools: project=${projectId} tools=${tools.length} ${mode} → ${OUTPUT_DIR}`,
  );

  await mkdir(OUTPUT_DIR, { recursive: true });

  const rows = [];
  const imageMs = [];
  const postMs = [];
  const failures = [];

  for (const tool of tools) {
    // Per-tool try/catch: one bad drawing must not cost the other thirty-nine
    // theirs. The tally at the end is what turns a partial run into a result.
    try {
      const imageStart = Date.now();
      const { imageBase64 } = await generateKitchenToolIconFlow({ label: tool.label });
      const imageTook = Date.now() - imageStart;
      imageMs.push(imageTook);

      const postStart = Date.now();
      const cut = await removeFlatBackground(Buffer.from(imageBase64, 'base64'));
      const webp = await normalizeIconFraming(cut, { contentMax: CONTENT_MAX });
      const postTook = Date.now() - postStart;
      postMs.push(postTook);

      await writeFile(resolve(OUTPUT_DIR, `${tool.id}.webp`), webp);

      if (apply) {
        const bucket = getStorage().bucket();
        const path = `kit-icons/${tool.id}.webp`;
        await bucket.file(path).save(webp, {
          contentType: 'image/webp',
          metadata: { cacheControl: 'public, max-age=31536000, immutable' },
        });
        const now = new Date().toISOString();
        // The document is written WITH THE THUMBNAIL ALREADY SET, and that is
        // deliberate rather than incidental: `onKitchenToolWritten`'s edge guard
        // skips any document whose thumbnail is non-null, so seeding never pays
        // for the same drawing twice. Writing the doc first and letting the
        // trigger fill it in would redraw all forty at the trigger's expense,
        // discarding the pictures this run just judged.
        await getFirestore()
          .collection(KITCHEN_TOOLS_COLLECTION)
          .doc(tool.id)
          .set({
            id: tool.id,
            schemaVersion: 1,
            label: tool.label,
            matchers: tool.matchers,
            thumbnail: buildStorageDownloadUrl(bucket.name, path),
            iconRequestedAt: Date.now(),
            createdAt: now,
            updatedAt: now,
          });
      }

      rows.push({ ...tool, image: true });
      console.log(
        `  ✓ ${tool.label} — image ${imageTook}ms, post ${postTook}ms, ${webp.length} bytes`,
      );
    } catch (err) {
      failures.push(tool.label);
      rows.push({ ...tool, image: false });
      console.error(`  ✗ ${tool.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const sheetPath = resolve(OUTPUT_DIR, 'index.html');
  await writeFile(sheetPath, contactSheet(rows));

  console.log(`\nseed-kitchen-tools: contact sheet → ${sheetPath}`);
  console.log(
    `seed-kitchen-tools: done — ${rows.length - failures.length} ok, ${failures.length} failed`,
  );
  console.log(
    `seed-kitchen-tools: image median ${median(imageMs)}ms (n=${imageMs.length}), ` +
      `post-process median ${median(postMs)}ms (n=${postMs.length})`,
  );
  if (failures.length > 0) {
    console.error(`seed-kitchen-tools: failed: ${failures.join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
