import { derived } from 'svelte/store';
import type { Readable } from 'svelte/store';
import { isCanonIconRenderable, resolveEquipmentItem } from '@salt/domain';
import type { EquipmentManifest } from '@salt/domain';
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

  // The owned item's icon, or null — which covers "no such item", "no icon
  // authored yet" and "hidden", all of which fall through to the tool vocabulary
  // and then to bare words.
  const ownedIcon = (
    label: string | null | undefined,
  ): { thumbnail: string; version: string | number | undefined } | null => {
    const name = label?.trim();
    if (!name) return null;
    const item = resolveEquipmentItem(name, items);
    if (!item) return null;
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
      return ownedIcon(label)?.thumbnail ?? tools.toolIconFor(label);
    },
    kitIconVersionFor(label) {
      const owned = ownedIcon(label);
      return owned ? owned.version : tools.toolIconVersionFor(label);
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
