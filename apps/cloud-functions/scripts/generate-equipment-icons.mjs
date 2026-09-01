// Offline equipment-pictogram generator (issue #877, Phase 1).
//
// WHY THIS EXISTS — this is the art direction being PROVEN before a pipeline is
// built around it. Nothing here is wired into the running app: no schema, no
// collection, no trigger, no rules, no UI. It reads the real equipment manifest,
// runs the two real flows, applies the two real imaging steps, and drops the
// results on local disk so the drawings can be judged and the prompts tuned.
// Iterating a prompt through a deployed Firestore trigger is slow and expensive;
// iterating it here costs one image.
//
// The pipeline it exercises is the one the app will run, in the same order:
//
//   describeEquipmentSubject   (text, 'fast' tier)  → a visual brief
//   generateEquipmentIcon      (image tier, seed-conditioned)
//   removeFlatBackground                            → 128px WebP with alpha
//   normalizeIconFraming({ contentMax: 108 })       → canon framing, tuned for
//                                                     the 40px row tile
//
// EACH PICTURE IS WRITTEN ALONGSIDE THE BRIEF IT WAS DRAWN FROM. That pairing is
// the point of the exercise, not bookkeeping: when an icon is wrong you need to
// know whether the DESCRIPTION was wrong or the DRAWING was, because those have
// different fixes. It is the same judgement the app's review gate will ask of the
// user, rehearsed offline. `index.html` in the output dir shows the whole set
// side by side, each icon against its own brief.
//
// It also TIMES THE TWO STEPS SEPARATELY and prints the medians. Those two
// numbers set two different budgets in Phase 2 — the describe time sets the brief
// trigger's, the image time sets the Draw callable's — and guessing them is how
// the canon path ended up with an outer 20s wrapper racing an inner 60s one.
//
// DRY/LOCAL BY DEFAULT. It writes files and reads Firestore; it writes nothing
// back to Firestore and uploads nothing to Storage unless `--apply` is passed
// (the same posture as scripts/reframe-canon-icons.ts).
//
// `--apply` is the ONE-OFF BACKFILL for a kit that already exists. It uploads
// each pictogram to `equipment-icons/{itemId}.webp` and writes the
// `equipmentIcons/{itemId}` document — brief, name, thumbnail, sourceName and a
// fresh cache-bust nonce — exactly as the Draw callable would.
//
// It DELIBERATELY BYPASSES THE REVIEW GATE, and that is not a hole in the gate.
// The gate exists so no image is generated from a description nobody has read;
// these descriptions were read by hand, side by side with their drawings, when
// this script was run without `--apply`. Nineteen button presses to seed a kit
// list that already exists is a chore the gate exists to PREVENT, not to create.
// Every item added after the backfill goes through the gate normally.
//
// ── HOW TO RUN ────────────────────────────────────────────────────────────
// This .mjs imports TypeScript modules from src/ directly, so it MUST be run
// under tsx. Two credentials are needed:
//   • GEMINI_API_KEY — from .secret.local, loaded via tsx's --env-file
//   • application-default credentials for the project whose manifest is read
//     (`gcloud auth application-default login`)
// Run from the cloud-functions package dir:
//
//   cd apps/cloud-functions
//
//   # the ~19 briefs and NO images — pennies, and where prompt tuning starts:
//   GOOGLE_CLOUD_PROJECT=s2-stage-ccb22 npx tsx --env-file=.secret.local \
//     scripts/generate-equipment-icons.mjs --briefs-only
//
//   # one or two items end to end (eyeball the house style before the full set):
//   GOOGLE_CLOUD_PROJECT=s2-stage-ccb22 npx tsx --env-file=.secret.local \
//     scripts/generate-equipment-icons.mjs kenwood "salad spinner"
//
//   # the whole manifest (no id args = every item), still local-only:
//   GOOGLE_CLOUD_PROJECT=s2-stage-ccb22 npx tsx --env-file=.secret.local \
//     scripts/generate-equipment-icons.mjs
//
//   # the one-off backfill: upload + write the icon docs as well
//   GOOGLE_CLOUD_PROJECT=s2-stage-ccb22 npx tsx --env-file=.secret.local \
//     scripts/generate-equipment-icons.mjs --apply
//
// Subset args match an item's id exactly, or a case-insensitive substring of its
// name — equipment ids are opaque uuids, so nobody is typing one. An arg that
// matches nothing is rejected with the list of names. Existing files are
// overwritten; the output dir is created if missing.
//
// Output → apps/cloud-functions/.equipment-icons.local/
//   <id>.webp   the pictogram
//   <id>.txt    the brief it was drawn from, with the item name
//   index.html  contact sheet: every icon beside its own brief
// (`.local` is gitignored repo-wide, so nothing here is ever committed.)
// ────────────────────────────────────────────────────────────────────────────

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

// Reused, NOT reimplemented: the two flows the app will run, and the two imaging
// steps the canon pipeline runs after them.
import { describeEquipmentSubjectFlow } from '../src/flows/describeEquipmentSubject.js';
import { generateEquipmentIconFlow } from '../src/flows/generateEquipmentIcon.js';
import { removeFlatBackground } from '../src/imaging/removeFlatBackground.js';
import { normalizeIconFraming } from '../src/imaging/normalizeIconFraming.js';
import { buildStorageDownloadUrl } from '../src/imaging/storageDownloadUrl.js';
import {
  EQUIPMENT_ICONS_COLLECTION,
  EQUIPMENT_MANIFEST_COLLECTION,
  EQUIPMENT_MANIFEST_DOC_ID,
  EquipmentManifestSchema,
} from '@salt/domain/schemas';

// The canon framing value, tuned for the 40px row tile (onCanonItemWritten.ts).
const CONTENT_MAX = 108;

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = resolve(pkgRoot, '.equipment-icons.local');

const briefsOnly = process.argv.includes('--briefs-only');
const apply = process.argv.includes('--apply');
const selectors = process.argv.slice(2).filter((a) => !a.startsWith('--'));

// The default bucket is derived from FIREBASE_CONFIG inside the CF runtime, which
// a standalone script has no access to — `getStorage().bucket()` would throw
// "Bucket name not specified". Every Salt project uses `<project>.firebasestorage.app`;
// STORAGE_BUCKET overrides it if that ever stops holding. (Same derivation as
// scripts/reframe-canon-icons.ts.)

const projectId = process.env['GOOGLE_CLOUD_PROJECT'] ?? process.env['GCLOUD_PROJECT'];

/** Read `equipmentManifest/current` and return its items, in manifest order. */
async function loadManifestItems() {
  const snap = await getFirestore()
    .collection(EQUIPMENT_MANIFEST_COLLECTION)
    .doc(EQUIPMENT_MANIFEST_DOC_ID)
    .get();
  if (!snap.exists) {
    throw new Error(
      `generate-equipment-icons: no ${EQUIPMENT_MANIFEST_COLLECTION}/${EQUIPMENT_MANIFEST_DOC_ID} doc in ${projectId}`,
    );
  }
  const parsed = EquipmentManifestSchema.safeParse(snap.data());
  if (!parsed.success) {
    throw new Error(
      `generate-equipment-icons: manifest failed validation: ${parsed.error.message}`,
    );
  }
  return parsed.data.items;
}

/** Narrow the manifest to the requested subset; no selectors = every item. */
function selectItems(items, args) {
  if (args.length === 0) return items;
  const chosen = new Map();
  const unmatched = [];
  for (const arg of args) {
    const needle = arg.toLowerCase();
    const hits = items.filter((it) => it.id === arg || it.name.toLowerCase().includes(needle));
    if (hits.length === 0) unmatched.push(arg);
    for (const hit of hits) chosen.set(hit.id, hit);
  }
  if (unmatched.length > 0) {
    throw new Error(
      `Nothing matched: ${unmatched.join(', ')}\nItems in the manifest:\n` +
        items.map((it) => `  ${it.id}  ${it.name}`).join('\n'),
    );
  }
  // Keep manifest order rather than argument order, so a contact sheet built
  // from a subset reads the same way as one built from the whole set.
  return items.filter((it) => chosen.has(it.id));
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
 * The contact sheet. The whole point of Phase 1 is judging a set side by side —
 * "does a Kenwood read as a Kenwood" is not a question you can answer one file
 * at a time in a Finder window — and judging the BRIEF next to the picture is
 * what tells you which of the two was at fault.
 */
function contactSheet(rows) {
  const cards = rows
    .map(
      (r) => `  <figure>
    ${r.image ? `<img src="${escapeHtml(r.id)}.webp" alt="${escapeHtml(r.name)}" />` : '<div class="missing">no image</div>'}
    <figcaption>
      <strong>${escapeHtml(r.name)}</strong>
      <p>${escapeHtml(r.brief ?? '— no brief —')}</p>
    </figcaption>
  </figure>`,
    )
    .join('\n');
  return `<!doctype html>
<meta charset="utf-8" />
<title>Equipment pictograms — issue #877 Phase 1</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 2rem; background: #faf8f5; color: #221; }
  h1 { font-size: 1.2rem; }
  figure { display: grid; grid-template-columns: 128px 1fr; gap: 1rem; align-items: start;
           margin: 0 0 1.25rem; padding-bottom: 1.25rem; border-bottom: 1px solid #e5e0d8; }
  img, .missing { width: 128px; height: 128px; background: #f0ece6; border-radius: 12px; }
  .missing { display: grid; place-items: center; font-size: 12px; color: #998; }
  figcaption p { margin: .35rem 0 0; color: #554; }
</style>
<h1>Equipment pictograms — ${rows.length} item(s)</h1>
${cards}
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
      'generate-equipment-icons: set GOOGLE_CLOUD_PROJECT to the project whose equipment manifest should be read (e.g. s2-stage-ccb22).',
    );
  }
  if (!process.env['GEMINI_API_KEY'] && !process.env['GOOGLE_API_KEY']) {
    throw new Error(
      'generate-equipment-icons: GEMINI_API_KEY (or GOOGLE_API_KEY) is not set. ' +
        'Run under tsx with --env-file=.secret.local.',
    );
  }

  if (briefsOnly && apply) {
    throw new Error(
      'generate-equipment-icons: --briefs-only and --apply are contradictory — ' +
        'there is no image to upload.',
    );
  }

  const storageBucket = process.env['STORAGE_BUCKET'] ?? `${projectId}.firebasestorage.app`;
  initializeApp({ projectId, credential: applicationDefault(), storageBucket });

  const items = selectItems(await loadManifestItems(), selectors);
  const mode = briefsOnly
    ? 'BRIEFS ONLY (no images)'
    : apply
      ? 'APPLY — uploads + writes equipmentIcons docs'
      : 'briefs + images, LOCAL ONLY (pass --apply to write)';
  console.log(
    `generate-equipment-icons: project=${projectId} items=${items.length} ${mode} → ${OUTPUT_DIR}`,
  );

  await mkdir(OUTPUT_DIR, { recursive: true });

  const rows = [];
  const describeMs = [];
  const imageMs = [];
  const postMs = [];
  const failures = [];

  for (const item of items) {
    // Per-item try/catch: one bad item must not cost the other eighteen their
    // generation. The tally at the end is what turns a partial run into a result.
    try {
      const describeStart = Date.now();
      const { brief } = await describeEquipmentSubjectFlow({ name: item.name });
      const describeTook = Date.now() - describeStart;
      describeMs.push(describeTook);

      await writeFile(resolve(OUTPUT_DIR, `${item.id}.txt`), `${item.name}\n\n${brief}\n`);
      console.log(`  · ${item.name} (${describeTook}ms)\n      ${brief}`);

      if (briefsOnly) {
        rows.push({ id: item.id, name: item.name, brief, image: false });
        continue;
      }

      const imageStart = Date.now();
      const { imageBase64 } = await generateEquipmentIconFlow({ name: item.name, brief });
      const imageTook = Date.now() - imageStart;
      imageMs.push(imageTook);

      const postStart = Date.now();
      const cut = await removeFlatBackground(Buffer.from(imageBase64, 'base64'));
      const webp = await normalizeIconFraming(cut, { contentMax: CONTENT_MAX });
      const postTook = Date.now() - postStart;
      postMs.push(postTook);

      await writeFile(resolve(OUTPUT_DIR, `${item.id}.webp`), webp);

      if (apply) {
        // Upload and stamp exactly what the Draw callable stamps, so a backfilled
        // item is indistinguishable from a drawn one — `sourceName` equal to
        // `briefSourceName` is what makes `equipmentIconAwaitingApproval` false,
        // i.e. "this has been drawn from the description it currently carries".
        // `immutable` + the nonce, matching the callable (and canon).
        const bucket = getStorage().bucket();
        const path = `equipment-icons/${item.id}.webp`;
        await bucket.file(path).save(webp, {
          contentType: 'image/webp',
          metadata: { cacheControl: 'public, max-age=31536000, immutable' },
        });
        await getFirestore()
          .collection(EQUIPMENT_ICONS_COLLECTION)
          .doc(item.id)
          .set(
            {
              subjectBrief: brief,
              briefSourceName: item.name,
              thumbnail: buildStorageDownloadUrl(bucket.name, path),
              sourceName: item.name,
              iconRequestedAt: Date.now(),
              updatedAt: new Date().toISOString(),
            },
            { merge: true },
          );
      }

      rows.push({ id: item.id, name: item.name, brief, image: true });
      console.log(
        `  ✓ ${item.name} — describe ${describeTook}ms, image ${imageTook}ms, post ${postTook}ms, ${webp.length} bytes`,
      );
    } catch (err) {
      failures.push(item.name);
      rows.push({ id: item.id, name: item.name, brief: undefined, image: false });
      console.error(`  ✗ ${item.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const sheetPath = resolve(OUTPUT_DIR, 'index.html');
  await writeFile(sheetPath, contactSheet(rows));

  console.log(`\ngenerate-equipment-icons: contact sheet → ${sheetPath}`);
  console.log(
    `generate-equipment-icons: done — ${rows.length - failures.length} ok, ${failures.length} failed`,
  );
  // The two numbers Phase 2 needs. Reported separately and by median, because
  // they set two independent timeouts on two different functions.
  console.log(
    `generate-equipment-icons: describe median ${median(describeMs)}ms (n=${describeMs.length}), ` +
      `image median ${median(imageMs)}ms (n=${imageMs.length}), ` +
      `post-process median ${median(postMs)}ms (n=${postMs.length})`,
  );
  if (failures.length > 0) {
    console.error(`generate-equipment-icons: failed: ${failures.join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
