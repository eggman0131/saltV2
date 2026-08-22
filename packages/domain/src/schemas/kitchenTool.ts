import { z } from 'zod';

// A generic kitchen tool — the fourth Tier-1 pictogram subject family (issue
// #882), after groceries (#148), weather (#387), product forms (#871) and
// equipment (#877).
//
// WHAT MAKES THIS FAMILY DIFFERENT: nothing points at one of these documents. A
// recipe step says "tip it into a large bowl" and a guided plan's card is called
// "Magmix bowl"; both store WORDS, and the tool is found from those words at
// display time by `resolveKitchenTool`. No id is ever written back onto a plan or
// a recipe, which is what makes the vocabulary safe to grow: adding "griddle pan"
// next month retroactively gives every step that already said it a picture, with
// nothing to migrate and nothing to regenerate.
//
// It is also why the collection is CURATED and closed rather than minted on
// demand the way canon items are. A miss costs a missing picture and nothing
// more — no orphan document, no review queue, no wrong answer downstream.
//
// Family-shared (no per-user scoping) and no soft-delete: Firestore is master,
// delete means delete.
export const KITCHEN_TOOLS_COLLECTION = 'kitchenTools';

export const KitchenToolSchema = z.object({
  // Kebab-case of the label — `mixing-bowl`, `chefs-knife`. Deterministic rather
  // than a uuid so the Storage object (`kit-icons/{id}.webp`) is predictable and
  // the weekly orphan sweep can join the two by id.
  id: z.string(),
  schemaVersion: z.literal(1),
  // The tool's name as a cook would say it, e.g. "Mixing bowl". Matched on equal
  // terms with `matchers` (see `resolveKitchenTool`) so a tool never has to
  // repeat its own name there, and used verbatim as the image prompt's subject.
  label: z.string(),
  // EXTRA phrasings that identify this tool in free text — "skillet" for a frying
  // pan, "pestle and mortar" for the mortar. Saved verbatim; folding happens at
  // match time, so there is no need to enumerate plurals or casing here.
  matchers: z.array(z.string()),
  // ─── Icon (Tier-1 pictogram) ──────────────────────────────────────────────
  // The same tri-state contract as `CanonItemSchema.thumbnail` (issue #148),
  // field-for-field: `null` = not generated yet, an https URL = a real icon,
  // `CANON_ICON_HIDDEN` = the user opted out and the trigger skips it forever.
  // Mirrored exactly rather than reinvented so `onKitchenToolWritten`, the orphan
  // sweep and `CanonIcon` all drop straight in with no new branch anywhere.
  //
  // `.default(null)` rather than a bare `.nullable()`, following productForms:
  // the seed script writes a document with its thumbnail already set, and a
  // hand-added tool has no `thumbnail` key at all until the trigger fires. The
  // default reads that absence as "not generated yet" — which is what it is —
  // instead of failing validation and being skipped by the subscription.
  thumbnail: z.string().nullable().default(null),
  // Transient one-shot steer for the next icon (re)generation, consumed and
  // cleared by the trigger's icon branch. Present from day one because the
  // vocabulary is hand-curated: when a whisk comes back looking like a beater,
  // the fix is a sentence, not a code change.
  iconHint: z.string().optional(),
  // Regenerate nonce (epoch ms), load-bearing for the same reason canon's is: a
  // no-op `.update()` emits no Firestore write event, so re-requesting an icon
  // for a tool whose thumbnail is ALREADY null would never re-fire the trigger
  // without a field that actually changes.
  iconRequestedAt: z.number().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type KitchenToolDoc = z.infer<typeof KitchenToolSchema>;
