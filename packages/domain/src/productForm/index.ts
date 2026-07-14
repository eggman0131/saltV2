// ProductForm module — published surface. The ONLY thing other domain modules
// and coordinators may import from productForm; anything not re-exported here is
// private to the module by design (mirrors canon/index.ts).
export type { ProductForm, ProductFormYield, CanonItemUnit } from './entities/ProductForm.js';
export type { ProductFormIdGenerator } from './ports/IdGenerator.js';
export { createProductForm } from './commands/createProductForm.js';
export type { CreateProductFormInput } from './commands/createProductForm.js';
export { updateProductForm } from './commands/updateProductForm.js';
export type { UpdateProductFormInput } from './commands/updateProductForm.js';
export { confirmProductForm } from './commands/confirmProductForm.js';
export { resolveProductForm } from './queries/resolveProductForm.js';
export { convertYield } from './queries/convertYield.js';
export { formParentCount } from './queries/formParentCount.js';
export { maxCountWinners } from './queries/maxCountWinners.js';
export { decideProductFormProposal } from './queries/decideProductFormProposal.js';
