import type { ShoppingListItem } from '../entities/ShoppingListItem.js';

export interface UnitSlot {
  readonly unit: string | undefined;
  readonly combinedAmount: number | undefined;
  readonly entries: readonly ShoppingListItem[];
}

export function combineItemsByUnit(items: readonly ShoppingListItem[]): readonly UnitSlot[] {
  const slotMap = new Map<string | undefined, ShoppingListItem[]>();

  for (const item of items) {
    const key = item.unit?.trim().toLowerCase();
    if (!slotMap.has(key)) slotMap.set(key, []);
    slotMap.get(key)!.push(item);
  }

  const slots: UnitSlot[] = [];
  for (const [, entries] of slotMap) {
    const amounts = entries.map((e) => e.amount).filter((a): a is number => a !== undefined);
    const combinedAmount = amounts.length > 0 ? amounts.reduce((s, a) => s + a, 0) : undefined;
    const unit = entries[0]?.unit;
    slots.push({ unit, combinedAmount, entries });
  }

  return slots;
}
