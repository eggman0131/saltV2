import { describe, it, expect } from 'vitest';
import { BREAD_FLAG_KEY as browserKey } from '../src/index.js';
import { BREAD_FLAG_KEY as serverKey } from '../src/server/index.js';
import { BREAD_FLAG_KEY as sharedKey } from '../src/shared/featureFlagKeys.js';

// ---------------------------------------------------------------------------
// Client/server feature-flag key PARITY (issue #1054).
//
// A gate is only a gate while both halves ask PostHog about the same flag. The
// bread gate is evaluated in the browser (`web-pwa`'s featureGate.ts) and again
// on the server (`onBatchWritten`, freezing a batch reminder's audience) — two
// apps that cannot import each other, so nothing but this package can hold the
// two spellings together.
//
// Two distinct claims, and each needs its own assertion:
//
//   1. Both subpaths export the SAME declaration. This is what a later re-
//      declaration in one barrel would break, and the identity check catches it
//      even though both values would still be strings.
//   2. The VALUE is still `'bread'`. Live PostHog targeting, cohorts and the
//      audiences already frozen into `batchStage` task payloads all key off it,
//      so this is not a name the repo is free to rename. Without this row the
//      file would be a tautology: two re-exports of one const agree with each
//      other no matter what that const says.
// ---------------------------------------------------------------------------

describe('BREAD_FLAG_KEY — one declaration, two subpaths', () => {
  it('is the same value on the browser barrel and the /server barrel', () => {
    expect(browserKey).toBe(serverKey);
    expect(browserKey).toBe(sharedKey);
  });

  it('is still the literal PostHog knows', () => {
    // Changing this string changes who sees the feature in production. It is a
    // deliberate act, not a rename — which is why it is spelled out here rather
    // than compared against itself.
    expect(sharedKey).toBe('bread');
  });
});
