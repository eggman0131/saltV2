// KitchenTool module — published surface. The ONLY thing other domain modules
// and coordinators may import from kitchenTool; anything not re-exported here is
// private to the module by design (mirrors productForm/index.ts).
//
// One query and no commands, which is the shape of the feature rather than an
// omission: the vocabulary is curated offline and read at display time, so there
// is nothing here that mutates a tool.
export { resolveKitchenTool } from './queries/resolveKitchenTool.js';
