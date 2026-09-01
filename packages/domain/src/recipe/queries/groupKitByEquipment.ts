import { normaliseName } from '../../canon/index.js';
import { resolveEquipmentItem } from '../../equipment/index.js';
import type { EquipmentItem } from '../../equipment/index.js';
import type { RecipeKitEntryDoc } from '../../schemas/index.js';

// Which pieces of a recipe's kit belong UNDER another one (issue #1140).
//
// The Equipment tab lists what to get out of the cupboards. Flat, it treats
// "Cosori 5L Rice Cooker" and "Rice Spoon" as two unrelated things, when the rice
// spoon is the rice cooker's — it came in the box. This is the derivation that
// puts the spoon under the cooker.
//
// DERIVED, NEVER STORED. A recipe's `kit` is free-text `{ label, stepIds }` and
// stays that way (#882, `schemas/recipe.ts`): no `equipmentItemId`, no
// `accessoryId`. The link this query needs already exists on the other side — the
// manifest states which accessories belong to which appliance — so the grouping is
// re-read every render from the words. Renaming an item in the manifest regroups
// every recipe at once, and nothing has to be migrated for it.
//
// PURE (CLAUDE.md rule 1), and in `domain` rather than the page for the reason
// `kitByStep` is: it is derivation, not display.
//
// TWO PASSES, AND THE SECOND IS DELIBERATELY NARROWER THAN THE FIRST.
//
// Pass one is `resolveEquipmentItem`, unchanged and un-loosened. Its two-part rule
// (the item's leading word, plus every other word explained by the item's own name
// or by ONE of its accessories) is what stops the bare word "pot" claiming the
// Magimix's Cocotte, and that refusal is load-bearing — see that file's header.
// Every entry pass one sees becomes a top-level row; the ones that resolved are the
// rows an accessory may later join.
//
// Pass two exists because the real library names accessories with no maker at all:
// staging carries `Rice Spoon`, `Hand Blender Attachment`, `Oven Sheet Pan` and
// `Wire Oven Rack` as kit labels in their own right, which pass one refuses by
// design. It runs only on entries pass one left unresolved, and nests one only when
// all three hold together:
//
//   1. the entry resolved to no owned item in pass one;
//   2. its normalised label EXACTLY equals an accessory's normalised name — never
//      containment, never a prefix. "Sheet Pan" does not find "Oven Sheet Pan";
//   3. the accessory's owning item ALREADY HEADS A ROW in this same recipe's kit.
//
// Condition 3 is the guard that makes conditions 1-2 safe to have at all. The
// manifest genuinely lists "Spatula", "Measuring Cup", "Kitchen Scales" and "Meat
// thermometer" as accessories of specific appliances; without it, a recipe saying
// "spatula" would file itself under a blender nobody mentioned. It is also why no
// appliance is ever INVENTED as a heading: the heads are exactly the entries the
// flow wrote, in the order it wrote them.
//
// AMBIGUITY IS A MISS HERE TOO, mirroring `resolveEquipmentItem`. If two DIFFERENT
// items that both head rows in this kit own an accessory of that name, the entry
// stays top-level rather than picking one. (Two accessories of the SAME item tying
// is not ambiguity — the answer is that item either way.)
//
// EVERY ENTRY APPEARS EXACTLY ONCE. An entry is a head or is nested under exactly
// one head, never both and never neither, so the total number of lines this
// produces always equals `kit.length` — which is what lets the tab's count stay
// `kit.length` however the rows are arranged. `groupKitByEquipment.test.ts` pins
// that as a property over every case in the file.

/** One top-level Equipment row, with the accessory rows that belong under it. */
export interface KitEquipmentGroup {
  /** The top-level entry, exactly as the flow stored it. */
  readonly entry: RecipeKitEntryDoc;
  /**
   * Entries whose label names an accessory of the item `entry` resolved to, in
   * stored order. Empty for a row that owns nothing named here — which is most
   * rows, and every row whose entry resolved to no owned item at all.
   */
  readonly accessories: readonly RecipeKitEntryDoc[];
}

/**
 * Fold a recipe's kit into display order, with accessories under their appliance.
 *
 * @param kit The recipe's `kit` entries, in stored order.
 * @param items The household's equipment manifest items. An empty list (nothing
 *   owned, or the manifest not loaded yet) yields every entry as its own flat
 *   row — the correct reading, and the one a cold load paints.
 * @returns One group per top-level row, in the order the flow listed them.
 */
export function groupKitByEquipment(
  kit: readonly RecipeKitEntryDoc[],
  items: readonly EquipmentItem[],
): KitEquipmentGroup[] {
  // Pass one. Every entry is a head for now; `owners` records which item each head
  // resolved to, so pass two can ask "is this accessory's appliance already here?"
  // without resolving anything a second time.
  const heads: { entry: RecipeKitEntryDoc; accessories: RecipeKitEntryDoc[] }[] = [];
  // itemId → the FIRST head that resolved to it. A kit naming one appliance twice
  // is not something the flow produces, but if it ever did, the accessories join
  // the first mention rather than being duplicated under both.
  const headOfItem = new Map<string, { accessories: RecipeKitEntryDoc[] }>();
  const unresolved: { index: number; entry: RecipeKitEntryDoc }[] = [];

  for (const entry of kit) {
    const head = { entry, accessories: [] as RecipeKitEntryDoc[] };
    const index = heads.push(head) - 1;
    const item = resolveEquipmentItem(entry.label, items);
    if (item) {
      if (!headOfItem.has(item.id)) headOfItem.set(item.id, head);
    } else {
      unresolved.push({ index, entry });
    }
  }

  // Pass two, over the unresolved entries only, in stored order.
  const nested = new Set<number>();
  for (const { index, entry } of unresolved) {
    const target = normaliseName(entry.label);
    if (!target) continue;

    // Only items that already head a row are candidates — condition 3.
    let owner: { accessories: RecipeKitEntryDoc[] } | null = null;
    let ambiguous = false;
    for (const item of items) {
      const head = headOfItem.get(item.id);
      if (!head) continue;
      const owns = (item.accessories ?? []).some(
        (accessory) => normaliseName(accessory.name) === target,
      );
      if (!owns) continue;
      // A second DISTINCT owning item is a tie; the same head twice is not.
      if (owner && owner !== head) {
        ambiguous = true;
        break;
      }
      owner = head;
    }
    if (ambiguous || !owner) continue;

    owner.accessories.push(entry);
    nested.add(index);
  }

  return heads.filter((_, i) => !nested.has(i));
}
