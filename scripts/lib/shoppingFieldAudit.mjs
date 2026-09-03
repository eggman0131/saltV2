// The per-field verdict that scripts/audit-shopping-list-fields.mjs is built on
// (issue #1114, phase 1). Pulled out here for the same reason
// scripts/lib/ttlMigrationPlan.mjs and scripts/lib/recipeTimesEstimated.mjs are:
// the CLI self-executes on import — it parses argv, shells to `gcloud` and hits
// the network at top level — so the decision it makes has no seam otherwise.
//
// The question it answers, per document, is exactly the one phase 1 exists to
// measure: would this document still parse if the `.default()` on each field
// were removed? Two answers are kept apart, because they license different
// phase-2 decisions:
//
//   ABSENT — the field is not on the document at all. This is the one the
//            defaults are hiding, and the only one where removing a default
//            would newly SKIP a real production row.
//   BAD    — the field is present and would fail the schema anyway. Today's
//            schema already rejects most of these (a wrong TYPE still fails,
//            per the issue's measured table); `matchState` and `id` are the
//            exceptions, which is why they carry their own reasons below.
//
// Input is Firestore REST `fields` — the typed encoding, `{stringValue: 'x'}`
// rather than `'x'` — because this repo's scripts talk to the REST API rather
// than the Admin SDK (see scripts/backfill-recipe-attribution.mjs's Auth note).

/** The four members `ShoppingListItemSchema`'s enum recognises. */
export const MATCH_STATES = ['pending', 'matched', 'needs_approval', 'failed'];

const isString = (v) => typeof v?.stringValue === 'string';
const isBoolean = (v) => typeof v?.booleanValue === 'boolean';
const isArray = (v) => v?.arrayValue !== undefined;
const isNullableString = (v) => isString(v) || v?.nullValue !== undefined;
// REST encodes a 64-bit integer as a STRING, so `z.literal(1)` reads back as
// `{integerValue: '1'}`. A double-encoded 1 is accepted too: the console writes
// a hand-typed number that way and it is the same value.
const isOne = (v) => v?.integerValue === '1' || v?.doubleValue === 1;

/**
 * A field the un-defaulted schema would require.
 *
 * `check` returns `null` when the present value is fine, or a short reason when
 * it is not. It is never called for an absent field.
 */
const field = (name, check) => ({ name, check });
const typed = (name, ok) => field(name, (v) => (ok(v) ? null : 'wrong type'));

/**
 * `id` on both collections, which is the one field phase 1 also uses as a
 * LICENCE rather than a measurement: the projection change delivers the
 * Firestore document id instead of this field, and that is only safe while the
 * two agree on every document (issue #1114 → "Decision: `id` is taken from the
 * Firestore document id"). A non-zero count here is a stop condition.
 */
const idField = field('id', (v, docId) => {
  if (!isString(v)) return 'wrong type';
  return v.stringValue === docId ? null : 'differs from document id';
});

/** `shoppingLists/{listId}` — `ShoppingListSchema`'s five fields. */
export const LIST_FIELDS = [
  idField,
  typed('name', isString),
  typed('schemaVersion', isOne),
  typed('createdAt', isString),
  typed('updatedAt', isString),
];

/**
 * `shoppingLists/{listId}/items/{itemId}` — the eleven non-additive fields of
 * `ShoppingListItemSchema`. The four additive ones (`traceContext`,
 * `formDemand`, `originalText`, `measureNote`) are correctly `.optional()` and
 * are deliberately not audited: their absence is the contract, not a finding.
 * `amount` and `unit` are `.optional()` for the same reason.
 */
export const ITEM_FIELDS = [
  idField,
  typed('rawText', isString),
  typed('notes', isString),
  typed('sources', isArray),
  typed('canonId', isNullableString),
  field('matchState', (v) => {
    if (!isString(v)) return 'wrong type';
    return MATCH_STATES.includes(v.stringValue) ? null : 'outside the enum';
  }),
  typed('checked', isBoolean),
  typed('needsCheck', isBoolean),
  typed('schemaVersion', isOne),
  typed('createdAt', isString),
  typed('updatedAt', isString),
];

/**
 * One document against one field spec.
 *
 * `fields` is the REST document's `fields` object, which is ABSENT ENTIRELY on
 * a document carrying none of the masked fields — so it is defaulted rather
 * than indexed into, and such a document reports every field absent.
 */
export function auditDocument(fields, docId, spec) {
  const present = fields ?? {};
  const absent = [];
  const bad = [];
  for (const { name, check } of spec) {
    const value = present[name];
    if (value === undefined) {
      absent.push(name);
      continue;
    }
    const why = check(value, docId);
    if (why !== null) bad.push({ field: name, why });
  }
  return { absent, bad };
}

/**
 * Roll a stream of `auditDocument` results into the per-field counts the issue
 * asks for: how many documents lack the field, and how many carry a value that
 * would fail — kept split by reason so `id`'s "differs from document id" and
 * `matchState`'s "outside the enum" are readable on their own rather than
 * summed into an undifferentiated "bad".
 */
export function tally(results, spec) {
  const counts = new Map(spec.map(({ name }) => [name, { absent: 0, bad: 0, reasons: new Map() }]));
  let documents = 0;
  for (const { absent, bad } of results) {
    documents += 1;
    for (const name of absent) counts.get(name).absent += 1;
    for (const { field: name, why } of bad) {
      const row = counts.get(name);
      row.bad += 1;
      row.reasons.set(why, (row.reasons.get(why) ?? 0) + 1);
    }
  }
  return { documents, counts };
}

/** The counts as a GitHub-flavoured markdown table, ready to paste on the issue. */
export function formatTable(title, { documents, counts }) {
  const lines = [`**${title}** — ${documents} document(s)`, '', '| field | absent | fails | why |'];
  lines.push('| --- | ---: | ---: | --- |');
  for (const [name, row] of counts) {
    const why =
      row.reasons.size === 0
        ? '—'
        : [...row.reasons].map(([reason, n]) => `${reason} ×${n}`).join(', ');
    lines.push(`| \`${name}\` | ${row.absent} | ${row.bad} | ${why} |`);
  }
  return lines.join('\n');
}
