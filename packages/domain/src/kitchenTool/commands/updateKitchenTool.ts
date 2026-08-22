import { ErrorCode, failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { KitchenToolDoc } from '../../schemas/kitchenTool.js';
import { normaliseMatchers } from './kitchenToolIdentity.js';

export interface UpdateKitchenToolInput {
  readonly label: string;
  readonly matchers: readonly string[];
}

/**
 * Apply an edit to an existing tool: a new label, a new matcher list, or both.
 * Pure — returns a new document and never mutates the input.
 *
 * THE ID DOES NOT MOVE when the label is reworded, even though the id was minted
 * from the label in the first place. It is the Storage key
 * (`kit-icons/{id}.webp`), so re-slugging on every edit would orphan the drawing
 * and hand the tool a fresh blank one for a typo fix. The id is an identity that
 * happened to be named after the label once; it is not a view of it.
 *
 * This is also the write behind "add as an alias": appending a phrase to
 * `matchers` and saving is the whole of it, and the shared normalisation is what
 * makes appending a phrase the tool already answers to a no-op rather than a
 * second copy of it.
 */
export function updateKitchenTool(
  tool: KitchenToolDoc,
  input: UpdateKitchenToolInput,
  now: string,
): ReadResult<KitchenToolDoc, DomainError> {
  const label = input.label.trim().replace(/\s+/g, ' ');
  if (!label) {
    return failure({ kind: 'ValidationError', code: ErrorCode.INVALID_KITCHEN_TOOL });
  }
  return success({
    ...tool,
    label,
    matchers: normaliseMatchers(input.matchers, label),
    updatedAt: now,
  });
}
