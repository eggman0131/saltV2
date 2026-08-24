// The prefix→collection table the weekly orphan sweep works from, plus the
// prefixes it deliberately does not (issue #919).
//
// Its own module, with no Firebase imports, for one reason: the coverage guard
// (`tests/maintenance/storageSweepCoverage.test.ts`) derives the full set of
// prefixes from `storage.rules` and checks every one appears here. Importing the
// real values beats regexing the sweep's source — a table read is exact where a
// regex is a second, weaker copy of the parser — and this module can be imported
// without paying for firebase-admin, firebase-functions and Genkit at module
// init, which is what kept the sweep's other guards to source scans.

export const SWEEPS = [
  { prefix: 'canon-icons/', collection: 'canonItems' },
  { prefix: 'recipe-images/', collection: 'recipes' },
  // Product-form pictograms (issue #871). Same deterministic keying as the two
  // above — `product-form-icons/{formId}.webp` — so deleting a form strands its
  // icon identically, and the join is the same join.
  { prefix: 'product-form-icons/', collection: 'productForms' },
  // Equipment pictograms (issue #877). Same deterministic-id shape as canon
  // icons: `equipment-icons/{itemId}.webp` beside `equipmentIcons/{itemId}`.
  // This pass only works because `onEquipmentManifestWritten` deletes the icon
  // DOC when its item leaves the manifest — otherwise the join below would find
  // the doc still present and correctly conclude the object is not orphaned.
  { prefix: 'equipment-icons/', collection: 'equipmentIcons' },
  // Generic kitchen-tool pictograms (issue #882). Same deterministic keying
  // again — `kit-icons/{toolId}.webp` beside `kitchenTools/{toolId}` — so
  // retiring a tool from the curated vocabulary strands its icon identically.
  { prefix: 'kit-icons/', collection: 'kitchenTools' },
] as const;

/**
 * Storage prefixes this sweep deliberately does NOT cover, and why (issue #919).
 *
 * `SWEEPS` is a list of what IS swept, and a list like that says nothing about
 * what it omits — `batch-images/` was missing for no recorded reason and nobody
 * could tell whether that was a decision or an oversight. So the omissions are
 * now written down, and `tests/maintenance/storageSweepCoverage.test.ts` derives
 * the full prefix set from `storage.rules` and fails on any prefix that appears
 * in neither table. A new prefix is a red test until somebody says which one it
 * belongs in; it can no longer be silently uncovered.
 */
export const UNSWEPT: Readonly<Record<string, string>> = {
  // `batch-images/{batchId}/{observationId}.webp` (#812). Two segments, so
  // `idFromObjectPath` returns null for every one of them and a SWEEPS row would
  // be a pass that deletes nothing — worse than no row, because it would read as
  // covered. It stays out for a stronger reason than shape, though: NOTHING
  // deletes a batch or an observation. `batchSync.ts` has no `deleteBatch` ("no
  // deleteBatch: nothing in this phase removes a run") and `batchObservationSync
  // .ts` has no delete either, so there is no way to orphan one of these objects
  // today and the pass would have no work to do. Issue #968 adds it — with the
  // `collectionGroup('observations')` join it actually needs — when a deleter
  // lands, which is the change that creates the orphan in the first place.
  'batch-images/': 'no deleter exists yet — nothing can orphan one (#968)',
};
