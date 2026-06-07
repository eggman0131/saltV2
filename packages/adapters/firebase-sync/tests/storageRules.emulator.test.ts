/**
 * Emulator integration test for storage.rules (issue #148, Phase 1).
 *
 * Asserts the canon-icons access model:
 *   - public read is allowed (any caller, even unauthenticated, can GET an icon)
 *   - client writes are denied (only the CF Admin SDK, which bypasses rules,
 *     may write icons)
 *
 * Requires the Storage emulator. The isolated Vitest docker stack
 * (docker-compose.vitest.yml) runs Firestore + Auth only, so this suite
 * SKIPS there; run it against the dev emulator instead:
 *
 *   pnpm dev:emulators                       # serves storage on :9199
 *   pnpm --filter @salt/firebase-sync test:emulator
 *
 * The reachability probe is timer-bounded (WSL2 free-port contract, #79): a
 * connect to a non-listening 127.0.0.1 port hangs here, so we race it against
 * an AbortController deadline rather than waiting for a refusal.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

const PROJECT_ID = 'demo-salt';
const STORAGE_HOST = '127.0.0.1';
const STORAGE_PORT = Number(
  (import.meta as { env?: Record<string, string | undefined> }).env?.[
    'VITE_EMULATOR_STORAGE_PORT'
  ] ?? '9199',
);

const RULES_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../storage.rules');

async function storageEmulatorReachable(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const resp = await fetch(`http://${STORAGE_HOST}:${STORAGE_PORT}/`, {
      signal: controller.signal,
    });
    // Any HTTP response (even 404/501) means the port is listening.
    return resp.status > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const reachable = await storageEmulatorReachable();
if (!reachable) {
  console.warn(
    `[storageRules.emulator] Storage emulator not reachable on ${STORAGE_HOST}:${STORAGE_PORT} — skipping (run the dev emulator to exercise these rules).`,
  );
}

describe.skipIf(!reachable)('storage.rules — canon-icons', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      storage: {
        host: STORAGE_HOST,
        port: STORAGE_PORT,
        rules: readFileSync(RULES_PATH, 'utf8'),
      },
    });
  });

  afterAll(async () => {
    await testEnv?.cleanup();
  });

  it('allows unauthenticated public read of a canon icon', async () => {
    // Seed an object via the privileged context (rules disabled), then read it
    // back as an unauthenticated caller.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const ref = ctx.storage().ref('canon-icons/seed.webp');
      await ref.put(new Uint8Array([1, 2, 3]), { contentType: 'image/webp' });
    });

    const ref = testEnv.unauthenticatedContext().storage().ref('canon-icons/seed.webp');
    await assertSucceeds(ref.getDownloadURL());
  });

  it('denies client writes to canon-icons (even when authenticated)', async () => {
    const ref = testEnv.authenticatedContext('user-1').storage().ref('canon-icons/blocked.webp');
    await assertFails(ref.put(new Uint8Array([4, 5, 6]), { contentType: 'image/webp' }));
  });

  it('denies reads and writes outside canon-icons', async () => {
    const ref = testEnv.authenticatedContext('user-1').storage().ref('other/secret.txt');
    await assertFails(ref.put(new Uint8Array([7]), { contentType: 'text/plain' }));
    await assertFails(ref.getDownloadURL());
  });
});
