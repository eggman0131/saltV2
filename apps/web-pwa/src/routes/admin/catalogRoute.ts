/**
 * How a catalog record is named in a URL and in a selection (issue #872).
 *
 * One list holds two record types, so a bare id is ambiguous: a selection that
 * spans canon items and product forms — and a `/admin/catalog/:id` that can open
 * either — needs the kind carried with the id. `c:` is a canon item, `f:` is a
 * product form.
 */
export type CatalogRecordKey = `c:${string}` | `f:${string}`;

/** The four views of the one list (issue #872). Single-select, in memory only. */
export type CatalogFilter = 'all' | 'needs-review' | 'has-forms' | 'no-threshold';

export const canonKey = (id: string): CatalogRecordKey => `c:${id}`;
export const formKey = (id: string): CatalogRecordKey => `f:${id}`;

export function parseRecordKey(key: string): { kind: 'canon' | 'form'; id: string } | null {
  if (key.startsWith('c:')) return { kind: 'canon', id: key.slice(2) };
  if (key.startsWith('f:')) return { kind: 'form', id: key.slice(2) };
  return null;
}

/**
 * Which door the catalog was opened by. `/admin/canon` and `/admin/product-forms`
 * survive as aliases so existing bookmarks still land somewhere correct, and the
 * path is the only thing that says which collection a bare `:id` belongs to.
 *
 * `listPath` is where a deleted record returns you to — the door you came in by,
 * not always `/admin/catalog`, so an aliased visit stays on its own path.
 */
export type CatalogArrival = {
  filter: CatalogFilter;
  listPath: string;
  /** Which collection a bare `:id` on this path belongs to; `null` ⇒ already namespaced. */
  idKind: 'canon' | 'form' | null;
};

export function readCatalogArrival(location: string): CatalogArrival {
  const path = location.split('?')[0] ?? '';
  if (path.startsWith('/admin/product-forms')) {
    return { filter: 'has-forms', listPath: '/admin/product-forms', idKind: 'form' };
  }
  if (path.startsWith('/admin/canon')) {
    return { filter: 'all', listPath: '/admin/canon', idKind: 'canon' };
  }
  return { filter: 'all', listPath: '/admin/catalog', idKind: null };
}

/**
 * The record the route asks for, or `null` for the bare list. An alias supplies
 * the kind from its path; `/admin/catalog/:id` carries an already-namespaced key
 * (that is what our own links use), and anything else opens nothing rather than
 * guessing which collection to look in.
 */
export function routeRecordKey(
  arrival: CatalogArrival,
  id: string | undefined,
): CatalogRecordKey | null {
  if (!id) return null;
  if (arrival.idKind === 'canon') return canonKey(id);
  if (arrival.idKind === 'form') return formKey(id);
  return parseRecordKey(id) ? (id as CatalogRecordKey) : null;
}
