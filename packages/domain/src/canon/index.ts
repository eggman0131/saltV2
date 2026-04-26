// Canon module — published surface.
// This file is the ONLY thing other domain modules and coordinators are allowed
// to import from canon. Adding to internals (entities/ports/commands/queries)
// without re-exporting here means it is private to canon by design.

export type { CanonItem } from './entities/CanonItem.js';
export type { CanonStorePort } from './ports/CanonStorePort.js';
export type { CanonLookupPort } from './ports/CanonLookupPort.js';
export { createCanonItem } from './commands/createCanonItem.js';
export type { CreateCanonItemInput } from './commands/createCanonItem.js';
export { createCanonLookup } from './queries/createCanonLookup.js';
