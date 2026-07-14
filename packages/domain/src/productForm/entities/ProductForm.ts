// ProductForm entity: an alternate form of an ingredient that resolves to a
// parent canon item plus a yield. Internal to the productForm module; other
// modules access it via the published index (re-exported as a type).
import type { CanonItemUnit } from '@salt/shared-types';
export type { CanonItemUnit };

export interface ProductFormYield {
  readonly formUnit: CanonItemUnit;
  readonly amountPerParent: number;
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
}
