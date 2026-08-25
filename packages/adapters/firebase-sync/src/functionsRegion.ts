/**
 * The one region every Cloud Function in this project is deployed to (#928,
 * finding B2-011).
 *
 * It used to be a bare `'europe-west2'` at twenty-nine call sites, while three
 * files kept a private `REGION` const of their own — so "the region" was a string
 * literal nobody owned, and moving it would have meant a search-and-replace with
 * no way to know whether it had caught everything. It is a constant now, and this
 * module has no imports so any callable wrapper can take it.
 *
 * Deliberately NOT exported from index.ts: consumers of this package call the
 * `call*` wrappers, and none of them has any business knowing where the functions
 * run.
 */
export const FUNCTIONS_REGION = 'europe-west2';
