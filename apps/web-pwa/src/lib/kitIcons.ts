import { derived } from 'svelte/store';
import type { Readable } from 'svelte/store';
import { isCanonIconRenderable, resolveEquipmentItem } from '@salt/domain';
import type { EquipmentItem, EquipmentManifest } from '@salt/domain';
import type { EquipmentIconDoc } from '@salt/domain/schemas';
import { toolIcons } from './kitchenToolService.js';
import type { ToolIconLookup } from './kitchenToolService.js';
import { equipment, equipmentIcons } from './equipmentService.js';

// The picture beside a piece of kit — on every surface that draws one (issue
// #954).
//
// THE POINT OF PUTTING THIS HERE. A kit label can now name a specific appliance
// this household owns, because #954 hands the inference flow the equipment
// manifest: "Magimix Cook Expert", not "food processor". Those items already have
// pictograms of their own, in `equipmentIcons` (#877/#879), and they are better
// pictures than any generic tool drawing could be — they are the thing in the
// cupboard. So every kit surface asks TWO vocabularies, in one fixed order, and it
// is defined once because the order is the load-bearing part.
//
// EQUIPMENT FIRST, ALWAYS. `resolveKitchenTool` matches on token-aligned
// containment, so "Magimix Cocotte Slow Cook Pot" contains "pot" and would resolve
// to a generic saucepan drawing — a specific label losing its own picture to a
// vague one, which is the whole defect #954 is fixing. Asking equipment first is
// what prevents it; making the tool resolver stricter is explicitly not (its
// `'Magmix bowl' → mixing-bowl` behaviour is correct and tested).
//
// THE MISS IS STILL A MISS. A label neither vocabulary knows returns null and
// renders as words with no picture — never a placeholder, never a near match
// (#882). Both halves fold the tri-state (`null` / a URL / the `"hidden"`
// sentinel) through `isCanonIconRenderable`, so "not drawn yet" and "hidden by the
// user" read the same as "not in the vocabulary".
//
// A RESOLVED ITEM IS AUTHORITATIVE — ITS MISS IS NOT THE TOOL VOCABULARY'S CUE.
// Once `resolveEquipmentItem` says a label names an owned item, that answer
// stands: a missing drawing on THAT item degrades to no tile, never to
// `resolveKitchenTool` on the same label. Staging has 15 of 20 `equipmentIcons`
// at `thumbnail: null` today, including both owned mandolines, so falling
// through would draw "OXO Good Grips Chef's Mandoline Slicer 2.0" as the
// GENERIC mandoline pictogram — the picture of neither mandoline this household
// owns, and precisely the defect #954 opened on. The tool vocabulary is
// consulted only when equipment resolves to NOTHING at all.
//
// A DERIVED STORE OF A LOOKUP rather than plain functions, for the reason
// `ingredientIcons` and `toolIcons` are: a plain function reading snapshots has no
// tracked dependency, so a manifest arriving after first paint — exactly what
// happens on a cold load — would leave every tile bare until something unrelated
// re-rendered the page.

/** The kit lookup a surface calls, resolved against one snapshot of both vocabularies. */
export interface KitIconLookup {
  /** The renderable pictogram URL for a free-text kit label, or null. */
  kitIconFor(label: string | null | undefined): string | null;
  /** The display-time cache-bust nonce for that same label, or undefined. */
  kitIconVersionFor(label: string | null | undefined): string | number | undefined;
}

function lookupFor(
  tools: ToolIconLookup,
  manifest: EquipmentManifest | null,
  icons: Map<string, EquipmentIconDoc>,
): KitIconLookup {
  const items = manifest?.items ?? [];

  // Does this label name an item the household owns? Resolved once and reused
  // by both lookups below, because the answer — not just the icon it produces —
  // is what gates the fall-through to the tool vocabulary.
  const ownedItem = (label: string | null | undefined): EquipmentItem | null => {
    const name = label?.trim();
    if (!name) return null;
    return resolveEquipmentItem(name, items);
  };

  // The resolved item's icon, or null — "no icon authored yet" and "hidden" both
  // fold to null here. Unlike a miss on `ownedItem`, this null does NOT fall
  // through to the tool vocabulary (see the header comment): a resolved item
  // with nothing drawn renders no tile, not a different object's picture.
  const ownedIcon = (
    item: EquipmentItem,
  ): { thumbnail: string; version: string | number | undefined } | null => {
    const icon = icons.get(item.id);
    const thumbnail = icon?.thumbnail ?? null;
    if (thumbnail === null || !isCanonIconRenderable(thumbnail)) return null;
    // The nonce is load-bearing on a redraw: the Storage path is reused and its
    // bytes are written `immutable`, so without it the browser serves the old
    // picture (ui-spec-v04 §14.4).
    return { thumbnail, version: icon?.iconRequestedAt };
  };

  return {
    kitIconFor(label) {
      const item = ownedItem(label);
      return item ? (ownedIcon(item)?.thumbnail ?? null) : tools.toolIconFor(label);
    },
    kitIconVersionFor(label) {
      const item = ownedItem(label);
      return item ? ownedIcon(item)?.version : tools.toolIconVersionFor(label);
    },
  };
}

/**
 * The shared lookup, recomputed whenever either vocabulary changes. Subscribe to
 * it (`$kitIcons.kitIconFor(label)`) so a tile fills in the moment the manifest or
 * the tool list lands.
 */
export const kitIcons: Readable<KitIconLookup> = derived(
  [toolIcons, equipment, equipmentIcons],
  ([$toolIcons, $equipment, $equipmentIcons]) => lookupFor($toolIcons, $equipment, $equipmentIcons),
);
