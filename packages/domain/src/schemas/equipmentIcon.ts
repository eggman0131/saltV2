import { z } from 'zod';

// Equipment pictograms (issue #877) — a SIBLING collection, one tiny document
// per equipment item, server-written and client-read.
//
// ─── Why this is not a field on the manifest ────────────────────────────────
// Equipment is not stored per item. The whole kit is ONE document,
// `equipmentManifest/current`, holding an `items[]` array, and every one of the
// nine domain mutators reaches `saveEquipmentManifest`, which does a
// WHOLE-DOCUMENT `setDoc` of the entire array (equipmentManifestSubscription.ts).
//
// Every other generated-image pipeline in Salt writes back with a partial
// `.update()` on a document whose identity matches the image's identity —
// `canonItems/{id}.thumbnail`, `recipes/{id}.image` — and Firestore's field-level
// merge is what makes that safe. Equipment has no such document. A `thumbnail` on
// the array element would mean:
//
//   • ticking one accessory's checkbox serialises the whole array back and can
//     wipe the icons off EVERY item, not just the edited one;
//   • the Cloud Function's write re-fires its own trigger on the whole manifest,
//     so seeding N icons is N full-manifest write events re-syncing to every
//     client;
//   • the trigger's guard degrades into an N-way array diff that any unrelated
//     item's edit fires.
//
// So the field gets its own collection. This is the `canonEmbeddings` move
// (#410) and the `guidedPlans` move: when a field and its host document have
// different owners and different read audiences, the field gets its own
// collection. The Cloud Function NEVER writes the manifest, so there is no
// self-refire and no LWW clobber.
//
// ─── Two names, two guards, and deliberately no status enum ─────────────────
// Because the CF never writes the manifest, the trigger can be LEVEL-triggered
// rather than edge-triggered — no nonce gymnastics, no loop risk.
//
//   • RE-AUTHOR THE BRIEF when no icon doc exists, or when
//     `briefSourceName !== item.name`. That is the trigger's only job, and it
//     hands rewrite-on-rename over for free.
//   • AWAITING APPROVAL is DERIVED, never stored — see
//     `equipmentIconAwaitingApproval` in `@salt/domain`. It covers both "never
//     drawn" (`sourceName` absent) and "renamed since the last draw", and it goes
//     false the instant a draw succeeds, because the draw stamps
//     `sourceName = briefSourceName`.
//
// Deriving that state from the two names instead of storing a status is what
// stops a failed or abandoned draw from needing bookkeeping of its own: there is
// no state to leave behind, because there is no state.
export const EQUIPMENT_ICONS_COLLECTION = 'equipmentIcons';

export const EquipmentIconSchema = z.object({
  /**
   * The appliance description — what the thing LOOKS LIKE, in brand-free words.
   * This is the one field shown to the user and the one field they may edit; the
   * locked house-style wording lives in code (`EQUIPMENT_STYLE_ANCHORS`) and is
   * never stored, never sent to the client and never editable.
   */
  subjectBrief: z.string().min(1),
  /** The item name the CURRENT brief was authored from. Drives the trigger's guard. */
  briefSourceName: z.string().min(1),
  /**
   * Tri-state, exactly as `CanonItem.thumbnail` (see `isCanonIconRenderable`):
   * `null` → nothing drawn yet; a URL → the picture; `"hidden"` → the user opted
   * out. `CanonIcon` renders all three without change.
   */
  thumbnail: z.string().nullable(),
  /**
   * The item name the CURRENT PICTURE was drawn from. Absent until the first
   * successful draw — which is precisely what makes "never drawn" and "renamed
   * since the draw" one comparison instead of two.
   */
  sourceName: z.string().optional(),
  /**
   * Cache-bust nonce, fed to `CanonIcon`'s `version` prop. Load-bearing: a redraw
   * reuses the same Storage object path, so the download URL is byte-identical
   * and a browser would serve the stale image for a year (the object is written
   * `immutable`, matching canon). Stamped fresh on every successful draw.
   */
  iconRequestedAt: z.number().optional(),
  /** Server write stamp. Audit only — nothing branches on it. */
  updatedAt: z.string().optional(),
});

export type EquipmentIconDoc = z.infer<typeof EquipmentIconSchema>;

// ─── Draw / Hide callable wire input ────────────────────────────────────────
// ONE callable takes an action rather than two callables, and both actions go
// through a callable at all because `equipmentIcons` is client-write-denied.
// Canon can afford a plain client write for hide (`hideCanonIcon`) because the
// sentinel lives on a document the client already writes; equipment has no such
// path, and opening a server-owned collection to client writes to mirror canon's
// split exactly would buy nothing.
//
// A discriminated union rather than an optional `brief`: a draw without a brief
// is not a request this callable should have to interpret, and the union makes
// that a parse failure rather than a runtime branch.
//
// There is deliberately NO `unhide` action. A draw overwrites `thumbnail` with
// the new URL whatever it held before, so pressing Draw IS the un-hide — canon
// needs a separate one only because its un-hide has to clear the field back to
// null and let a trigger pick it up.
export const DrawEquipmentIconInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('draw'),
    itemId: z.string().min(1),
    // The brief actually drawn from — the stored one, or the user's edit of it.
    // Bounded because it is free user text heading for an AI prompt.
    brief: z.string().min(1).max(2000),
  }),
  z.object({
    action: z.literal('hide'),
    itemId: z.string().min(1),
  }),
]);

export type DrawEquipmentIconInput = z.infer<typeof DrawEquipmentIconInputSchema>;
