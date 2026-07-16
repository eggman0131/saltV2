// ProductForm entity: an alternate form of an ingredient that resolves to a
// parent canon item plus a yield. Internal to the productForm module; other
// modules access it via the published index (re-exported as a type).
import type { CanonItemUnit } from '@salt/shared-types';
export type { CanonItemUnit };

export interface ProductFormYield {
  readonly formUnit: CanonItemUnit;
  readonly amountPerParent: number;
}

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
export interface FormDemand {
  // The ProductForm this demand came from. Demands sharing a formId SUM (the
  // same form needed by several recipes); distinct formIds MAX (different forms
  // of one parent are shared, not double-bought).
  readonly formId: string;
  readonly parentCount: number;
}

export interface ProductForm {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly matchers: readonly string[];
  readonly parentCanonId: string;
  readonly label: string;
  readonly yield: ProductFormYield;
  // Sync field — parity with canon; empty string is the pre-sync sentinel.
  readonly updatedAt: string;
  // Needs-review flag (issue #500, Phase 3), mirroring canon's `needs_approval`.
  // Absent/false = confirmed; an AI-seeded proposal carries `true` until an admin
  // confirms it. TRANSPORT for the review UI only — never a gate on resolution.
  readonly needs_approval?: boolean;
}
