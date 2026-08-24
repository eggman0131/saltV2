import { getFirestore, doc, setDoc } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import { classifyFirestoreError } from './firestoreErrors.js';

// ─────────────────────────────────────────────────────────────────────────────
// E2E AI stub writer (test-infra Phase 1) — emulator-only.
//
// The browser counterpart of apps/cloud-functions/src/ai/fakeModel.ts. It writes
// the canned answer a faked CF model should return into a Firestore doc both
// processes can see (the emulator's Firestore is shared between client and CF):
//
//   `_e2e_ai_stubs/{flowName}` → { response: <JSON>, updatedAt: <ISO> }
//
// The CF fake model (active only under FUNCTIONS_AI_FAKE=1) reads this doc and
// returns `response` as the model output. `flowName` is the Genkit flow name
// (e.g. 'populateEquipmentEntry'); `response` is the exact structured object the
// flow's `ai.generate({ output })` should resolve to.
//
// This is invoked only from the e2e bridge (apps/web-pwa e2eHooks.ts), which is
// itself gated on VITE_USE_EMULATORS — so this never runs against production.
// ─────────────────────────────────────────────────────────────────────────────

export const E2E_AI_STUB_COLLECTION = '_e2e_ai_stubs';

/**
 * Registers the canned answer the CF fake model returns for `flowName`.
 * Test-only; resolves once the stub doc is written to the (emulator) Firestore.
 *
 * Test infrastructure is still adapter code: the failure crosses back as a
 * `Failure<DomainError>` (Rule 10) so the e2e bridge can say the stub never
 * landed instead of the spec failing later for an unrelated-looking reason.
 */
export async function setAiStub(
  flowName: string,
  response: unknown,
): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await setDoc(doc(db, E2E_AI_STUB_COLLECTION, flowName), {
      response: response ?? null,
      updatedAt: new Date().toISOString(),
    });
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}
