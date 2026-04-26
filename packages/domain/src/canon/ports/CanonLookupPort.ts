import type { CanonItem } from '../entities/CanonItem.js';

// Module-offered port: canonicalisation logic exposed to other domain modules.
// Implemented by canon's own queries (see queries/createCanonLookup).
// Other modules consume this interface; they never reach into canon's queries directly.
export interface CanonLookupPort {
  findClosestMatch(rawName: string): Promise<CanonItem | null>;
  normaliseName(rawName: string): string;
}
