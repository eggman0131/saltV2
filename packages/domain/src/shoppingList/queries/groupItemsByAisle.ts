import type { ShoppingListItem } from '../entities/ShoppingListItem.js';

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
  // Items in the order the user added them (createdAt ascending).
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

  for (const item of items) {
    if (item.checked) {
      checkedItems.push(item);
      continue;
    }

    const isMatchedToAisle =
      (item.matchState === 'matched' || item.matchState === 'needs_approval') &&
      item.canonId !== null &&
      canonMap.has(item.canonId) &&
      canonMap.get(item.canonId)!.aisleId !== null;

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

    const sorted = [...aisleItems].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    aisleGroups.push({ aisleId: aisle.id, aisleName: aisle.name, items: sorted });
  }

  return {
    other: { contributors: otherContributors },
    aisles: aisleGroups,
    checked: { contributors: checkedItems },
  };
}
