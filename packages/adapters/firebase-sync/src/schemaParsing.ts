// The parse loop, once (issue #928, findings B2-005 and B2-006).
//
// Every Firestore read in this package does the same three things with a
// document: hand its raw data to a zod schema, keep it if it parses, and say so
// on the console if it does not. That loop used to be written out verbatim in
// fifteen subscriptions and again in three one-shot list reads. It is written
// here instead, and the readers pass what actually differs between them — the
// collection, the schema, and the name the rejection carries.
//
// Nothing here reaches Firestore. It is the parsing half of the contract, so a
// live subscription (subscribeCollection.ts), a keyed read (subscribeDocument.ts)
// and a `getDocs` one-shot can all share it without sharing a query.

/**
 * The slice of a zod schema these readers use.
 *
 * Structural rather than `z.ZodType`, deliberately: `firebase-sync` does not
 * depend on zod. The schemas arrive already built from `@salt/domain/schemas`
 * and this package only ever calls `safeParse` on them, so naming the type
 * properly would mean a new dependency and a layer-map edit for nothing.
 */
export interface ParsedBy<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: unknown };
}

/** As much of a Firestore document snapshot as a parse loop needs. */
export interface ReadableDoc {
  readonly id: string;
  data(): unknown;
}

/**
 * The rejection log, in the one format the whole package emits:
 * `[SchemaName] Document {id} failed validation`, with the zod error behind it.
 *
 * The id is bound into the message on purpose. It is the only thing that tells a
 * document that was REFUSED from one the query never returned — an unbound
 * "failed validation" is satisfied by a rejection of anything at all — and
 * `tests/subscriptionContract.emulator.test.ts` matches on exactly this string.
 */
export function logRejection(label: string, id: string, error: unknown): void {
  console.error(`[${label}] Document ${id} failed validation`, error);
}

/**
 * What one document came to: the projected value, or nothing because the schema
 * refused it (and `logRejection` has already said so).
 *
 * A refusal is a VALUE rather than an absence so that `subscribeCollection` can
 * CACHE one (issue #939). Its per-snapshot cache is keyed by document id and
 * falls through to `parseDocument` on a miss, so a refusal recorded as `undefined`
 * would be indistinguishable from a document never seen: a corrupt document would
 * be re-parsed and re-logged on every snapshot for as long as it sat in the
 * collection. `{ok: false}` is what makes "already refused, and already said so"
 * a thing the cache can hold.
 */
export type ParseOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

/**
 * One document, parsed: `safeParse`, then `project` it or log and refuse it.
 *
 * The single place the skip-and-log half of the contract is written. Both
 * readers go through it — `parseDocuments` below for a whole result set, and
 * `subscribeCollection` for the one document a snapshot actually changed — so
 * neither can drift on what a rejection does or what it says.
 */
export function parseDocument<TParsed, TDelivered>(
  d: ReadableDoc,
  schema: ParsedBy<TParsed>,
  label: string,
  project: (parsed: TParsed, id: string) => TDelivered,
): ParseOutcome<TDelivered> {
  const result = schema.safeParse(d.data());
  if (!result.success) {
    logRejection(label, d.id, result.error);
    return { ok: false };
  }
  return { ok: true, value: project(result.data, d.id) };
}

/**
 * The LIST read contract (CLAUDE.md, zod conventions): parse every document,
 * skip and log the invalid ones, deliver the valid subset. One corrupt document
 * must never fail the whole read.
 *
 * `project` is what each caller does with a document once it has parsed — the
 * identity for most, an `as` where the domain type and the schema's output type
 * are two names for one shape, and a real transform for canon (#410). It takes
 * the document id because that is not always a field: `subscribeEquipmentIcons`
 * keys its Map by it.
 *
 * This is the ONE-SHOT read now (`getDocs`): a live listener parses only what
 * changed, in `subscribeCollection`.
 */
export function parseDocuments<TParsed, TDelivered>(
  docs: readonly ReadableDoc[],
  schema: ParsedBy<TParsed>,
  label: string,
  project: (parsed: TParsed, id: string) => TDelivered,
): TDelivered[] {
  const valid: TDelivered[] = [];
  for (const d of docs) {
    const outcome = parseDocument(d, schema, label, project);
    if (outcome.ok) valid.push(outcome.value);
  }
  return valid;
}
