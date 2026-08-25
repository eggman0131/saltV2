import { httpsCallable, getFunctions } from 'firebase/functions';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure, ErrorCode } from '@salt/shared-types';
import {
  EquipmentIconSchema,
  EQUIPMENT_ICONS_COLLECTION,
  type EquipmentIconDoc,
  type DrawEquipmentIconInput,
  type DescribeEquipmentSubjectInput,
  type DescribeEquipmentSubjectOutput,
} from '@salt/domain/schemas';
import { classifyCallableError } from './callableErrors.js';
import { subscribeCollection } from './subscribeCollection.js';
import { FUNCTIONS_REGION } from './functionsRegion.js';

// Equipment pictograms (issue #877) — the read side of the server-owned
// `equipmentIcons` collection, plus the one callable that writes it.
//
// The collection is client-write-denied in firestore.rules, so there is no
// upsert/delete here to match `canonSubscription`'s: the brief trigger creates
// and reconciles the documents, and the Draw callable is the only mutation the
// client can reach.

/**
 * Subscribe to every equipment icon document.
 *
 * SKIP-AND-LOG on a per-document validation failure, following
 * `subscribeCanonItems` and the list-read convention: one corrupt document must
 * not fail the whole read. Note this deliberately does NOT inherit
 * `equipmentManifestSubscription`'s posture, where a single bad item fails the
 * entire manifest — that is defensible for one document that IS the collection,
 * and wrong for a collection of independent ones. A missing icon renders as the
 * pale placeholder tile, which is a state the UI already has to handle.
 *
 * Stream-level errors still surface via `onError`.
 */
export function subscribeEquipmentIcons(
  onIcons: (icons: Map<string, EquipmentIconDoc>) => void,
  onError: (err: DomainError, rawError?: unknown) => void,
): () => void {
  return subscribeCollection(
    {
      path: [EQUIPMENT_ICONS_COLLECTION],
      schema: EquipmentIconSchema,
      label: 'EquipmentIconSchema',
      // Keyed by the DOCUMENT id — the equipment item it belongs to, which the
      // icon document itself does not carry as a field.
      project: (icon, id): [string, EquipmentIconDoc] => [id, icon],
      forwardsRawError: true,
    },
    (entries) => onIcons(new Map(entries)),
    onError,
  );
}

/**
 * Draw or hide an equipment pictogram (issue #877).
 *
 * Both actions go through this one authenticated callable because the collection
 * is client-write-denied. A DRAW carries the brief actually being drawn from —
 * the stored description, or the user's edit of it — which is the whole point of
 * the review gate: correcting the words is how you fix the picture.
 *
 * Never throws (Rule 10): every failure crosses the boundary as
 * `Failure<DomainError>`.
 */
export async function callDrawEquipmentIcon(
  input: DrawEquipmentIconInput,
): Promise<ReadResult<void, DomainError>> {
  try {
    const fn = httpsCallable<DrawEquipmentIconInput, { ok: true }>(
      getFunctions(undefined, FUNCTIONS_REGION),
      'drawEquipmentIcon',
    );
    await fn(input);
    return success(undefined);
  } catch (err) {
    // `failed-precondition` is the kill switch being off, or no description
    // written yet — both are expected states with a friendly message, not
    // defects, so they must not be reported (see the error-reporting policy).
    return failure(
      classifyCallableError(err, {
        'failed-precondition': {
          kind: 'ValidationError',
          code: ErrorCode.EQUIPMENT_ICON_NOT_DRAWABLE,
        },
      }),
    );
  }
}

/**
 * Write (or rewrite) an equipment item's description — the words a pictogram is
 * drawn from (issue #885).
 *
 * Two shapes, one callable: pass `currentBrief` + `hint` to REVISE the existing
 * sentence per a correction, or the name alone to author a fresh one ("Start
 * over"). It PERSISTS NOTHING — the brief comes back to the caller and only ever
 * reaches Firestore when the user presses Draw, which is what makes iterating on
 * the words cheap and the picture the only thing that costs.
 *
 * Returns the brief itself: the wrapper object exists only for Genkit's
 * structured output and no caller wants it.
 *
 * Never throws (Rule 10): every failure crosses the boundary as
 * `Failure<DomainError>`. `invalid-argument` is the callable refusing a payload
 * the schema would not take (an over-long correction, an item with no name) — an
 * expected state with a friendly message rather than a defect, so it crosses as a
 * `ValidationError` and is deliberately not reported.
 */
export async function callDescribeEquipmentSubject(
  input: DescribeEquipmentSubjectInput,
): Promise<ReadResult<string, DomainError>> {
  try {
    const fn = httpsCallable<DescribeEquipmentSubjectInput, DescribeEquipmentSubjectOutput>(
      getFunctions(undefined, FUNCTIONS_REGION),
      'describeEquipmentSubject',
    );
    const res = await fn(input);
    return success(res.data.brief);
  } catch (err) {
    return failure(
      classifyCallableError(err, {
        'invalid-argument': {
          kind: 'ValidationError',
          code: ErrorCode.EQUIPMENT_BRIEF_NOT_WRITABLE,
        },
      }),
    );
  }
}
