// ProductForm entity: an alternate form of an ingredient that resolves to a
// parent canon item plus a yield. Internal to the productForm module; other
// modules access it via the published index (re-exported as a type).
//
// Schema-first (issue #417, carried here by issue #932): aliases of the
// inferred schema types, so the entities and the stored document cannot drift.
import type { CanonItemUnit } from '@salt/shared-types';
import type { ProductFormDoc, ProductFormYieldDoc } from '../../schemas/productForm.js';
import type { FormDemandDoc } from '../../schemas/shoppingListItem.js';
export type { CanonItemUnit };

export type ProductFormYield = ProductFormYieldDoc;

// One product-form contributor's demand on its parent, persisted on a shopping
// item so the display layer can aggregate correctly across recipes (issue #501).
//
// `parentCount` is the UNROUNDED parent-count this form's raw amount converts to
// (`convertYield(amount, form.yield)` — e.g. 10 g of zest against a 5 g/lime
// yield → 2). Storing the fractional PARENT-COUNT rather than the raw form
// amount + yield is loss-free because the conversion is linear: summing
// parentCounts across recipes equals summing raw amounts and converting once
// (Σaᵢ)/p == Σ(aᵢ/p). That keeps the yield out of the shopping doc entirely —
// the display aggregation needs no ProductForm snapshot, and a later yield edit
// can't retro-corrupt an already-written item.
//
// Demands sharing a `formId` SUM (the same form needed by several recipes);
// distinct formIds MAX (different forms of one parent are shared, not
// double-bought).
//
// The type is declared by this module but its schema lives beside the item that
// persists it (`schemas/shoppingListItem.ts`) — a real cross-module oddity that
// stays; only the declaration moves here.
export type FormDemand = FormDemandDoc;

// `matchers` are EXTRA phrasings a recipe might use, beyond the label itself;
// `resolveProductForm` matches the label on equal terms with them, so the label
// is not display-only (issue #818). `updatedAt` is a sync field with the empty
// string as its pre-sync sentinel. `needs_approval` mirrors canon's — absent or
// false means confirmed, and it is TRANSPORT for the review UI only, never a
// gate on resolution. `thumbnail` is tri-state exactly as `CanonItem.thumbnail`
// (`null` / an https URL / `CANON_ICON_HIDDEN`) and stays REQUIRED because
// `upsertProductForm` writes the entity as a full document and Firestore
// rejects `undefined`. `iconHint` and `iconRequestedAt` are server-owned.
export type ProductForm = ProductFormDoc;
