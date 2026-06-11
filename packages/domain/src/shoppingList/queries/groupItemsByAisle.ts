import type { ShoppingListItem } from '../entities/ShoppingListItem.js';
import { hasLiveCanonMatch } from '../../canon/index.js';

export interface CanonInfo {
  readonly id: string;
  readonly name: string;
  readonly aisleId: string | null;
}

export interface AisleInfo {
  readonly id: string;
  readonly name: string;
  readonly order: number;
}

export interface OtherContributor {
  readonly item: ShoppingListItem;
  readonly isPending: boolean;
}

export interface OtherBucket {
  readonly contributors: readonly OtherContributor[];
}

export interface CheckedBucket {
  readonly contributors: readonly ShoppingListItem[];
}

export interface AisleGroup {
  readonly aisleId: string;
  readonly aisleName: string;
  // Items sorted alphabetically by their matched canon item's name, so rows
  // resolving to the same canon cluster together (createdAt breaks ties).
  readonly items: readonly ShoppingListItem[];
}

export interface GroupedShoppingList {
  readonly other: OtherBucket;
  readonly aisles: readonly AisleGroup[];
  readonly checked: CheckedBucket;
}

export function groupItemsByAisle(
  items: readonly ShoppingListItem[],
  canonMap: ReadonlyMap<string, CanonInfo>,
  aisles: readonly AisleInfo[],
): GroupedShoppingList {
  const otherContributors: OtherContributor[] = [];
  const checkedItems: ShoppingListItem[] = [];
  const aisleMap = new Map<string, ShoppingListItem[]>();
  const liveCanonIds = new Set(canonMap.keys());

  for (const item of items) {
    if (item.checked) {
      checkedItems.push(item);
      continue;
    }

    const isMatchedToAisle =
      hasLiveCanonMatch(item, liveCanonIds) && canonMap.get(item.canonId!)!.aisleId !== null;

    if (!isMatchedToAisle) {
      otherContributors.push({
        item,
        isPending: item.matchState === 'pending',
      });
      continue;
    }

    const aisleId = canonMap.get(item.canonId!)!.aisleId!;
    if (!aisleMap.has(aisleId)) aisleMap.set(aisleId, []);
    aisleMap.get(aisleId)!.push(item);
  }

  // Most-recently-checked first so the shopper can easily undo.
  checkedItems.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const sortedAisles = [...aisles].sort((a, b) => a.order - b.order);

  const aisleGroups: AisleGroup[] = [];
  for (const aisle of sortedAisles) {
    const aisleItems = aisleMap.get(aisle.id);
    if (!aisleItems || aisleItems.length === 0) continue;

    // Sort by the matched canon item's name so every row resolving to the same
    // canon (e.g. all "Onions") clusters together regardless of its raw text.
    // createdAt breaks ties so items sharing a canon keep a stable insertion order.
    const sorted = [...aisleItems].sort((a, b) => {
      const nameA = canonMap.get(a.canonId!)!.name;
      const nameB = canonMap.get(b.canonId!)!.name;
      const byName = nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
      return byName !== 0 ? byName : a.createdAt.localeCompare(b.createdAt);
    });
    aisleGroups.push({ aisleId: aisle.id, aisleName: aisle.name, items: sorted });
  }

  return {
    other: { contributors: otherContributors },
    aisles: aisleGroups,
    checked: { contributors: checkedItems },
  };
}
