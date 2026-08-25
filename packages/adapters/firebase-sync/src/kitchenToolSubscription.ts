import { getFirestore, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import { KitchenToolSchema, KITCHEN_TOOLS_COLLECTION } from '@salt/domain/schemas';
import type { KitchenToolDoc } from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';
import { subscribeCollection } from './subscribeCollection.js';

// Kitchen-tool pictogram vocabulary (issue #882) — the read side of the curated
// `kitchenTools` collection, plus the two plain writes that maintain it.
//
// The collection follows the CANON model, not the server-owned `equipmentIcons`
// one: any authenticated client may write a tool document, and the
// `onKitchenToolWritten` trigger stamps the generated `thumbnail` back via the
// Admin SDK. That is what makes adding, regenerating or hiding a tool an ordinary
// document write with no callable in front of it.

/**
 * Subscribe to the whole tool vocabulary.
 *
 * SKIP-AND-LOG on a per-document validation failure, following
 * `subscribeCanonItems` and the list-read convention: one corrupt document must
 * not fail the whole read. Deliberately NOT `equipmentManifestSubscription`'s
 * posture, where a single bad item fails everything — that is defensible for one
 * document that IS the collection, and wrong for a collection of independent
 * ones. A tool that drops out simply stops matching, and the words render on
 * their own, which is a state every surface already handles.
 *
 * Stream-level errors still surface via `onError`. Never throws (Rule 10).
 */
export function subscribeKitchenTools(
  onTools: (tools: KitchenToolDoc[]) => void,
  // rawError forwards the original Firestore error alongside the categorised
  // DomainError so the service report site can send the REAL stack to PostHog.
  onError: (err: DomainError, rawError?: unknown) => void,
): () => void {
  return subscribeCollection(
    {
      path: [KITCHEN_TOOLS_COLLECTION],
      schema: KitchenToolSchema,
      label: 'KitchenToolSchema',
      project: (tool) => tool,
      forwardsRawError: true,
    },
    onTools,
    onError,
  );
}

/**
 * Write a tool document whole (LWW, the house contract — no merge logic at any
 * layer). Creating and editing are the same call because the id is deterministic
 * kebab-case of the label.
 *
 * Crosses back as a `Failure<DomainError>` rather than throwing (Rule 10), like
 * every other write in the package.
 */
export async function upsertKitchenTool(
  tool: KitchenToolDoc,
): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await setDoc(doc(db, KITCHEN_TOOLS_COLLECTION, tool.id), { ...tool });
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}

/**
 * Remove a tool from the vocabulary. No soft-delete and no tombstone: Firestore
 * is master, and the weekly orphan sweep reclaims the `kit-icons/{id}.webp`
 * object once the document is gone.
 *
 * Crosses back as a `Failure<DomainError>` rather than throwing (Rule 10), like
 * `deleteCanonItem` and `deleteProductForm` — the admin page has a toast to show
 * and no business catching a Firestore exception.
 */
export async function deleteKitchenTool(id: string): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await deleteDoc(doc(db, KITCHEN_TOOLS_COLLECTION, id));
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}
