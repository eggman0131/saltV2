import type { CanonItem } from '../entities/CanonItem.js';

// Module-offered port: canonicalisation logic exposed to other domain modules.
// Implemented by canon's own queries (see queries/createCanonLookup).
//
// Lookup is synchronous because canon is loaded into memory at startup
// (see Salt local-first decisions). Other modules can call findClosestMatch
// from inside their own pure logic without awaiting.
//
// `refresh` lets the composition layer push a new canon set into the lookup
// after a sync brings in updates, without reconstructing the port.
export interface CanonLookupPort {
  findClosestMatch(rawName: string): CanonItem | null;
  normaliseName(rawName: string): string;
  refresh(items: readonly CanonItem[]): void;
}
