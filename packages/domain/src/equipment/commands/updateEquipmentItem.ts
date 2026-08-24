import { failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { EquipmentItem } from '../entities/EquipmentItem.js';
import type { EquipmentManifest } from '../entities/EquipmentManifest.js';

// The body every equipment mutation shares: find the item or fail NotFound, let
// the caller decide the change, stamp `updatedAt` and put it back in the
// manifest. Internal to the module — not re-exported from `index.ts`, because it
// is how the commands are written, not something callers should reach for.
//
// This exists because seven commands had written it out seven times (issue
// #924), and the copies had already started to drift: `addRule`, `editRule` and
// `renameEquipment` validated their argument BEFORE looking the equipment up,
// while `removeRule` and both accessory commands looked it up first.
//
// GUARD ORDER, decided once and now structural rather than remembered:
// existence first. The subject of a command has to exist before its arguments
// can be judged against it — `editRule` and `removeRule` cannot range-check
// `ruleIndex` without `item.rules.length`, and both accessory commands cannot
// look for an accessory without an item to look in, so half the family was
// already forced into that order by its data. Making it the rule for all seven
// costs nothing and removes the choice. The only inputs whose result changes are
// ones that are invalid twice over — a blank rule for equipment that does not
// exist now reports the missing equipment rather than the blank rule, which is
// the more useful of the two answers and the one the caller must handle first.
export function updateEquipmentItem(
  manifest: EquipmentManifest,
  equipmentId: string,
  now: string,
  change: (item: EquipmentItem) => ReadResult<EquipmentItem, DomainError>,
): ReadResult<EquipmentManifest, DomainError> {
  const item = manifest.items.find((i) => i.id === equipmentId);
  if (!item) {
    return failure({ kind: 'NotFound', resource: 'equipment', id: equipmentId });
  }
  const changed = change(item);
  if (changed.kind !== 'ok') {
    return changed;
  }
  const updated: EquipmentItem = { ...changed.value, updatedAt: now };
  return success({
    ...manifest,
    items: manifest.items.map((i) => (i.id === equipmentId ? updated : i)),
  });
}
