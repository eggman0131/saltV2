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
 * The LIST read contract (CLAUDE.md, zod conventions): parse every document,
 * skip and log the invalid ones, deliver the valid subset. One corrupt document
 * must never fail the whole read.
 *
 * `project` is what each caller does with a document once it has parsed — the
 * identity for most, an `as` where the domain type and the schema's output type
 * are two names for one shape, and a real transform for canon (#410). It takes
 * the document id because that is not always a field: `subscribeEquipmentIcons`
 * keys its Map by it.
 */
export function parseDocuments<TParsed, TDelivered>(
  docs: readonly ReadableDoc[],
  schema: ParsedBy<TParsed>,
  label: string,
  project: (parsed: TParsed, id: string) => TDelivered,
): TDelivered[] {
  const valid: TDelivered[] = [];
  for (const d of docs) {
    const result = schema.safeParse(d.data());
    if (result.success) {
      valid.push(project(result.data, d.id));
    } else {
      logRejection(label, d.id, result.error);
    }
  }
  return valid;
}
