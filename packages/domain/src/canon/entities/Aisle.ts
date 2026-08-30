import type { AisleDoc } from '../../schemas/aislesDocument.js';

// One aisle within the shared `aisles` document (see AislesDocumentSchema).
// Schema-first (issue #417, carried here by issue #932): an alias of the
// inferred schema type, so the entity and the stored document cannot drift.
export type Aisle = AisleDoc;
