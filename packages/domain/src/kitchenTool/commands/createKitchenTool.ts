import { ErrorCode, failure, success } from '@salt/shared-types';
import type { DomainError, ReadResult } from '@salt/shared-types';
import type { KitchenToolDoc } from '../../schemas/kitchenTool.js';
import { kitchenToolSlug, normaliseMatchers } from './kitchenToolIdentity.js';

export interface CreateKitchenToolInput {
  readonly label: string;
  readonly matchers: readonly string[];
}

/**
 * Mint a new tool for the drawn vocabulary (issue #882, Phase 4).
 *
 * `existing` is the vocabulary as it stands, and it is here for one reason: the
 * id is DERIVED from the label, so two people naming the same thing produce the
 * same id, and a plain write would replace a curated tool — its matchers, its
 * drawing — with a blank one. That is not a merge conflict Firestore's LWW is
 * entitled to resolve, so it crosses back as a `ConflictError` and the page says
 * so.
 *
 * Matchers may legitimately be EMPTY, unlike a product form's: the resolver
 * competes the label on equal terms, so a tool called exactly what everyone calls
 * it needs no synonyms. A quarter of the seeded vocabulary is like this.
 *
 * `thumbnail: null` is stated rather than left to the schema default: the
 * `onKitchenToolWritten` edge guard reads exactly this null on the create write
 * to decide to draw, and an omitted key would be written as `undefined`, which
 * Firestore rejects outright.
 *
 * Reads no clock (`now` is passed) and no store — pure, per the layer contract.
 */
export function createKitchenTool(
  input: CreateKitchenToolInput,
  existing: readonly KitchenToolDoc[],
  now: string,
): ReadResult<KitchenToolDoc, DomainError> {
  const label = input.label.trim().replace(/\s+/g, ' ');
  const id = kitchenToolSlug(label);
  // A label of pure punctuation slugs to nothing, and a tool with no id has no
  // drawing to be stored against it.
  if (!label || !id) {
    return failure({ kind: 'ValidationError', code: ErrorCode.INVALID_KITCHEN_TOOL });
  }
  if (existing.some((t) => t.id === id)) {
    return failure({ kind: 'ConflictError' });
  }
  return success({
    id,
    schemaVersion: 1,
    label,
    matchers: normaliseMatchers(input.matchers, label),
    thumbnail: null,
    createdAt: now,
    updatedAt: now,
  });
}
