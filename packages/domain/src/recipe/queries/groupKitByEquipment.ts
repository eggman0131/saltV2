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
//
// That second half of the rule is why pass one cannot simply make every entry a
// head (issue #1182). `Magimix Cook Expert` and `Magimix Cocotte Slow Cook Pot`
// BOTH resolve — correctly, to the same item — so making both heads drew the same
// machine twice, side by side, wearing one picture: the exact "two unrelated
// things" reading this whole derivation exists to remove. So pass one nests as
// well, under one rule:
//
//   an entry whose label is spelled out of one of the item's ACCESSORIES nests
//   under the entry that names the item ITSELF.
//
// WHICH ENTRY HEADS IS NOT DECIDED BY STORED ORDER. `namesTheItemItself` below is
// the whole test; position only breaks a tie between two entries that both name
// the item directly. The alternative — first mention heads — was written and
// reverted during #1179's review, because with the pot listed first ("roughly the
// order it is needed in" produces that) the POT became the head and the machine
// rendered indented and muted beneath it, asserting that the appliance is a part
// of its own accessory. A missing relationship is bad; a false one is worse. This
// is pass two's stated principle — stored order decides where the heads go, never
// what belongs to what — finally applied to pass one as well.
//
// THE BOUNDARY, because the absolute would be false (CLAUDE.md rule 12): one item
// can still head two rows, in the two cases where nesting would have to state
// something untrue. A kit naming the same appliance twice IN ITS OWN WORDS
// ("Cosori 5L Rice Cooker" and "Cosori Rice Cooker") keeps both rows — a machine
// is not an accessory of itself. And two accessory-form labels with no entry
// naming the appliance ("Magimix Cocotte Slow Cook Pot" beside "Magimix Blender
// Jug", no Magimix) keep both rows too, because nesting either under the other
// would claim one accessory owns the other, and no appliance is ever invented as
// a heading. Both are pinned in `groupKitByEquipment.test.ts`.
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
// appliance is ever INVENTED as a heading: every head is an entry the flow wrote,
// and the heads appear in the order it wrote them.
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
   * stored order — whether spelled bare ("Rice Spoon", pass two) or with the
   * owner's leading word ("Magimix Cocotte Slow Cook Pot", pass one). Empty for a
   * row that owns nothing named here — which is most rows, and every row whose
   * entry resolved to no owned item at all.
   */
  readonly accessories: readonly RecipeKitEntryDoc[];
}

/**
 * Is this label spelled out of the item's OWN name, rather than out of one of its
 * accessories?
 *
 * Not a resolver and not a second opinion on one: `resolveEquipmentItem` has
 * already decided that `label` names `item`, and this asks the one thing its
 * return value cannot say — which half of its two-part rule got it there. So the
 * item is a given here, never searched for, and loosening or tightening this
 * cannot make a label resolve to something it otherwise would not.
 *
 * Both sides fold through the same `normaliseName` the resolver uses, so the two
 * cannot disagree about case, punctuation, plurals or stripped model numbers.
 */
function namesTheItemItself(label: string, item: EquipmentItem): boolean {
  const own = new Set(normaliseName(item.name).split(' ').filter(Boolean));
  return normaliseName(label)
    .split(' ')
    .filter(Boolean)
    .every((word) => own.has(word));
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
  // Resolve every entry once, up front. Nothing below calls the resolver again.
  const resolved = kit.map((entry) => resolveEquipmentItem(entry.label, items));

  // itemId → the index of the entry that HEADS that item's row, decided before any
  // row exists so that stored order cannot decide it. Only an entry naming the item
  // itself is eligible; among two that do, the earlier wins, which is the only place
  // position gets a say.
  const headIndexOfItem = new Map<string, number>();
  kit.forEach((entry, index) => {
    const item = resolved[index];
    if (!item || headIndexOfItem.has(item.id)) return;
    if (namesTheItemItself(entry.label, item)) headIndexOfItem.set(item.id, index);
  });

  // Pass one's whole new rule, stated once: an entry nests when it resolves to an
  // item ANOTHER entry names directly, and is not itself such a naming. A second
  // naming of the machine itself is a duplicate mention, not a part of the machine,
  // and keeps its own row.
  const nestsUnderItem: (string | null)[] = kit.map((entry, index) => {
    const item = resolved[index];
    if (!item) return null;
    const headIndex = headIndexOfItem.get(item.id);
    if (headIndex === undefined || headIndex === index) return null;
    return namesTheItemItself(entry.label, item) ? null : item.id;
  });

  // The rows themselves, in stored order. `headOfItem` then lets pass two ask "is
  // this accessory's appliance already here?" without resolving anything twice.
  type Head = {
    index: number;
    entry: RecipeKitEntryDoc;
    accessories: { index: number; entry: RecipeKitEntryDoc }[];
  };
  const heads: Head[] = [];
  const headOfItem = new Map<string, Head>();
  const unresolved: { index: number; entry: RecipeKitEntryDoc }[] = [];

  kit.forEach((entry, index) => {
    if (nestsUnderItem[index]) return; // placed below, once every head exists
    const head: Head = { index, entry, accessories: [] };
    heads.push(head);
    const item = resolved[index];
    if (item) {
      if (!headOfItem.has(item.id)) headOfItem.set(item.id, head);
    } else {
      unresolved.push({ index, entry });
    }
  });

  // Place pass one's nested entries. The head is always there: it is the entry
  // `headIndexOfItem` picked, which by construction never nests and resolves to
  // this item ahead of any other head that could have claimed the slot. The
  // "exactly once" property test is what would go red if that stopped holding.
  nestsUnderItem.forEach((itemId, index) => {
    if (!itemId) return;
    headOfItem.get(itemId)!.accessories.push({ index, entry: kit[index]! });
  });

  // Pass two, over the unresolved entries only, in stored order.
  const nested = new Set<number>();
  for (const { index, entry } of unresolved) {
    const target = normaliseName(entry.label);
    if (!target) continue;

    // Only items that already head a row are candidates — condition 3.
    let owner: Head | null = null;
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

    owner.accessories.push({ index, entry });
    nested.add(index);
  }

  return heads
    .filter((head) => !nested.has(head.index))
    .map((head) => ({
      entry: head.entry,
      // Stored order, not the order the two passes happened to nest them in.
      accessories: [...head.accessories].sort((a, b) => a.index - b.index).map((a) => a.entry),
    }));
}
