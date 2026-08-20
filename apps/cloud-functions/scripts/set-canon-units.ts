// One-off operator script: give every referenced canon item a `unit`.
//
// WHY THIS EXISTS — `unit` is written by AI arbitration at canon-creation time
// (`matchOrCreate`), so an item reached by a plain match, or created before the
// field existed, simply has none. In staging that is 90 of 277 items, 42 of them
// referenced by a live recipe. The consequence is not cosmetic:
// `ingredientMatchIssue` reports `missing_form` ONLY when the matched canon is
// `unit: 'count'`, so a count-sold item with no unit is invisible to the recipe
// list's match pip however wrong the line above it is. Filling this is what makes
// the pip able to see the #855/#857 class at all — and therefore what lets anyone
// tell whether a later re-match pass actually worked.
//
// WHY A HAND-WRITTEN TABLE AND NOT A DERIVATION — there isn't one. Being the
// parent of a product form looks like it must imply `count` (a yield reads as
// "how much one parent produces"), but staging has two counter-examples:
// `Beetroot` (fermented brine, 50 ml per parent) and `Mature Cheddar` (slices, 10
// per parent) are form parents sold by mass. How a shop sells a thing is an
// opinion about shopping, so it is written down by a person and reviewed as a
// list, rather than inferred by a rule that would be wrong a fifth of the time.
//
// WHY NOT ASK THE MODEL — arbitration is exactly what failed to set these. Asking
// it again would re-run the same judgement that is currently absent, at AI cost,
// with no way to review the answer before it lands. Forty-two lines of table is
// cheaper and auditable.
//
// SAFE BY DEFAULT: dry run (prints every proposed change) unless `--apply`.
//
// The write is a PARTIAL update of `unit` alone, for the reasons
// scripts/backfill-recipe-attribution.mjs sets out: canon is last-write-wins per
// WHOLE document and `onCanonItemWritten` writes back to it, so a full-document
// write from here could clobber a concurrent trigger write. It deliberately does
// NOT move `updatedAt` — how a shop sells lemons is not a change to the lemon.
//
// TRIGGER SAFETY: `onCanonItemWritten` fires once per updated item and both its
// branches no-op — `iconNeedsGeneration` returns false for an item that has a
// thumbnail (and for one that was null before and stays null with no
// `iconRequestedAt` bump), and `maybeGenerateEmbedding` returns early because the
// `canonEmbeddings/{id}` doc already exists. No icon is regenerated, no embedding
// recomputed, no AI is called.
//
// NEVER OVERWRITES: an item that already carries a unit is left exactly as it is,
// whatever the table says. Re-running reports "0 to set" and writes nothing. That
// is the right default — the table must not silently fight arbitration on items
// it already decided — but it also means a row of the table that turns out to be
// WRONG cannot be corrected by editing it and re-running. `--force` is that
// escape hatch: it rewrites the units of table entries only, so the blast radius
// is the 42 names written down here and nothing else.
//
// USAGE (from apps/cloud-functions) — no secrets, no AI key:
//   GOOGLE_CLOUD_PROJECT=s2-stage-ccb22 pnpm exec tsx scripts/set-canon-units.ts
//   GOOGLE_CLOUD_PROJECT=s2-stage-ccb22 pnpm exec tsx scripts/set-canon-units.ts --apply
//   … edit a row you disagree with, then:
//   GOOGLE_CLOUD_PROJECT=s2-stage-ccb22 pnpm exec tsx scripts/set-canon-units.ts --apply --force

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { normaliseName } from '@salt/domain';
import { CanonItemSchema } from '@salt/domain/schemas';

type Unit = 'g' | 'ml' | 'count';

// The reviewed decision list, keyed by canon NAME (matched through
// `normaliseName`, the same folding the matcher uses) rather than by document id
// so it can be read and corrected by a human without a lookup table beside it.
//
// `count` means: the shop sells you whole ones and the recipe asks for whole
// ones. `g`/`ml` mean the shop weighs or pours it. Soft herbs are `g` because a
// UK supermarket sells them as a weighed packet even though recipes say
// "a handful"; roots and bulbs sold loose (ginger, beetroot) are likewise `g`.
const UNITS: Readonly<Record<string, Unit>> = {
  // ── Form parents whose absent unit breaks a form that already exists ──
  'Whole Chicken': 'count',
  'Delicatessen Olives': 'g',

  // ── Produce sold as whole items ──
  'Red Onion': 'count',
  'Spring Onion': 'count',
  Lemon: 'count',
  'Red Chilli': 'count',
  'Red Pepper': 'count',
  Cucumber: 'count',
  'Romaine Lettuce': 'count',
  Lettuce: 'count',
  'White Cabbage': 'count',
  'Daikon Radish': 'count',
  Fennel: 'count',
  Celery: 'count',
  'Pak Choi': 'count',
  "Bird's Eye Chilli": 'count',
  'Cinnamon Stick': 'count',

  // ── Weighed or poured ──
  'unsalted butter': 'g',
  Ginger: 'g',
  'Ground Ginger': 'g',
  Ghee: 'g',
  Asparagus: 'g',
  'Nicoise Olives': 'g',
  'ramen noodle': 'g',
  // Referenced in prod but not in staging — the two corpora have drifted slightly.
  'dried penne': 'g',
  'Prague Powder': 'g',
  'Kebab Meat': 'g',
  'Vegetable Scraps': 'g',
  'Suhana Paneer Makhanwala Mix': 'g',
  'Bottled Lemon Juice': 'ml',
  Whey: 'ml',
  Custard: 'ml',
  'Garlic Sauce': 'ml',

  // ── Soft herbs: a weighed packet, not a bunch you count ──
  'fresh mint': 'g',
  'fresh thyme': 'g',
  'fresh dill': 'g',
  'fresh basil': 'g',
  'fresh tarragon': 'g',
  'fresh sage leave': 'g',
  'Sweet Basil': 'g',
  'Fresh Coriander': 'g',
  Parsley: 'g',
  Herb: 'g',
};

const projectId = process.env['GOOGLE_CLOUD_PROJECT'] ?? process.env['GCLOUD_PROJECT'];
if (!projectId) {
  console.error('Set GOOGLE_CLOUD_PROJECT to the target Firebase project id.');
  process.exit(1);
}

const apply = process.argv.includes('--apply');
const force = process.argv.includes('--force');
const useEmulator = Boolean(process.env['FIRESTORE_EMULATOR_HOST']);
initializeApp(useEmulator ? { projectId } : { projectId, credential: applicationDefault() });
const db = getFirestore();

const byNormalisedName = new Map<string, Unit>();
for (const [name, unit] of Object.entries(UNITS)) byNormalisedName.set(normaliseName(name), unit);

const snapshot = await db.collection('canonItems').get();

const toSet: { id: string; name: string; unit: Unit; from: string }[] = [];
const alreadySet: string[] = [];
const matchedNames = new Set<string>();
let unparseable = 0;

for (const doc of snapshot.docs) {
  const parsed = CanonItemSchema.safeParse({ id: doc.id, ...doc.data() });
  if (!parsed.success) {
    unparseable += 1;
    continue;
  }
  const item = parsed.data;
  const key = normaliseName(item.name);
  const proposed = byNormalisedName.get(key);
  if (proposed === undefined) continue;
  matchedNames.add(key);
  if (item.unit !== undefined && !(force && item.unit !== proposed)) {
    alreadySet.push(`${item.name} (${item.unit})`);
    continue;
  }
  toSet.push({ id: item.id, name: item.name, unit: proposed, from: item.unit ?? '—' });
}

console.log(`\nproject          ${projectId}`);
console.log(
  `canon items      ${snapshot.size}${unparseable > 0 ? ` (${unparseable} unparseable)` : ''}`,
);
console.log(`table entries    ${Object.keys(UNITS).length}`);
console.log(`to set           ${toSet.length}`);
console.log(
  `already set      ${alreadySet.length}${alreadySet.length > 0 ? `  ${alreadySet.join(', ')}` : ''}`,
);

// A table entry that matches nothing is a typo or a canon item that has since
// been renamed or deleted. Named loudly rather than passed over: a silent miss
// is how a decision list rots into a list of things that used to be true.
const unmatched = [...byNormalisedName.keys()].filter((k) => !matchedNames.has(k));
if (unmatched.length > 0) {
  console.log(`NO SUCH CANON    ${unmatched.length}  ${unmatched.join(', ')}`);
}

console.log('');
for (const { name, unit, from } of [...toSet].sort((a, b) => a.name.localeCompare(b.name))) {
  console.log(`  ${name.padEnd(34)} ${from.padEnd(6)} →  ${unit}`);
}

if (!apply) {
  console.log(
    `\nDry run. Nothing written. Re-run with --apply to ${force ? 'rewrite' : 'set'} these ${toSet.length}.\n`,
  );
  process.exit(0);
}

let written = 0;
for (const { id, name, unit } of toSet) {
  try {
    await db.collection('canonItems').doc(id).update({ unit });
    written += 1;
  } catch (err) {
    console.error(`FAILED ${name} (${id})`, err);
  }
}
console.log(`\nSet ${written} of ${toSet.length}.\n`);
process.exit(written === toSet.length ? 0 : 1);
