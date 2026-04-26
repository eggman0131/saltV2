import type { CanonStorePort } from '../ports/CanonStorePort.js';
import type { CanonLookupPort } from '../ports/CanonLookupPort.js';
import { findClosestMatch } from './findClosestMatch.js';
import { normaliseName } from './normaliseName.js';

// Wires canon's pure query functions to a CanonStorePort to produce a
// CanonLookupPort implementation. The composition layer (web-pwa) calls this
// with a real store adapter at startup.
export function createCanonLookup(store: CanonStorePort): CanonLookupPort {
  return {
    async findClosestMatch(rawName) {
      const items = await store.list();
      return findClosestMatch(items, rawName);
    },
    normaliseName,
  };
}
