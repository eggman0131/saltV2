import type { CanonItem } from '../entities/CanonItem.js';
import { mergeCanonItems } from './mergeCanonItems.js';

export type ConflictStrategy = 'keep-local' | 'keep-remote' | 'merge';

export function resolveCanonConflict(
  strategy: ConflictStrategy,
  local: CanonItem,
  remote: CanonItem,
): CanonItem {
  switch (strategy) {
    case 'keep-local':
      return local;
    case 'keep-remote':
      return remote;
    case 'merge':
      return mergeCanonItems(local, remote);
  }
}
