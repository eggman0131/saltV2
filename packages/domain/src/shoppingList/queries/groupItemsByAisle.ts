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

export interface ItemGroup {
  readonly canonId: string;
  readonly canonName: string;
  readonly contributors: readonly ShoppingListItem[];
  readonly allChecked: boolean;
}

export interface AisleGroup {
  readonly aisleId: string;
  readonly aisleName: string;
  // Unchecked/partial groups first (alphabetical by canonName), fully-checked groups last.
  readonly groups: readonly ItemGroup[];
}

export interface GroupedShoppingList {
  readonly other: OtherBucket;
  readonly aisles: readonly AisleGroup[];
}

export function groupItemsByAisle(
  items: readonly ShoppingListItem[],
  canonMap: ReadonlyMap<string, CanonInfo>,
  aisles: readonly AisleInfo[],
): GroupedShoppingList {
  const otherContributors: OtherContributor[] = [];
  // aisleId → canonId → items
  const aisleMap = new Map<string, Map<string, ShoppingListItem[]>>();

  for (const item of items) {
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

    const canon = canonMap.get(item.canonId!)!;
    const aisleId = canon.aisleId!;

    if (!aisleMap.has(aisleId)) {
      aisleMap.set(aisleId, new Map());
    }
    const canonGroup = aisleMap.get(aisleId)!;
    if (!canonGroup.has(item.canonId!)) {
      canonGroup.set(item.canonId!, []);
    }
    canonGroup.get(item.canonId!)!.push(item);
  }

  const sortedAisles = [...aisles].sort((a, b) => a.order - b.order);

  const aisleGroups: AisleGroup[] = [];
  for (const aisle of sortedAisles) {
    const canonGroup = aisleMap.get(aisle.id);
    if (!canonGroup || canonGroup.size === 0) continue;

    const groups: ItemGroup[] = [];
    for (const [canonId, groupItems] of canonGroup) {
      const canon = canonMap.get(canonId)!;
      const allChecked = groupItems.every((i) => i.checked);
      // Unchecked contributors first within a group.
      const sortedContributors = [...groupItems].sort((a, b) => {
        if (a.checked === b.checked) return 0;
        return a.checked ? 1 : -1;
      });
      groups.push({ canonId, canonName: canon.name, contributors: sortedContributors, allChecked });
    }

    // Sort groups: partial/unchecked groups alphabetically first, fully-checked groups last.
    groups.sort((a, b) => {
      if (a.allChecked !== b.allChecked) return a.allChecked ? 1 : -1;
      return a.canonName.localeCompare(b.canonName);
    });

    aisleGroups.push({ aisleId: aisle.id, aisleName: aisle.name, groups });
  }

  return { other: { contributors: otherContributors }, aisles: aisleGroups };
}
