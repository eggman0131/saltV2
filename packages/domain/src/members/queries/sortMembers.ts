import type { Member } from '../entities/Member.js';

// Stable display order for the roster (issue #155): ascending sortOrder, then
// name (locale-aware, case-insensitive) as a tie-break so equal/duplicate
// sortOrder values still render deterministically. Pure — returns a new array.
export function sortMembers(members: readonly Member[]): Member[] {
  return [...members].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}
