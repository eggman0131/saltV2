// @ts-nocheck — boundary fixture; ESLint must flag this import even when the
// named symbols are not part of the @salt/domain public surface.
//
// VIOLATION: cloud-functions must reach canon matching stages only via
// findClosestMatch (or matchOrCreate). Calling exactNameMatch / tokenMatch /
// stringSimilarity / synonymMatch / embedMatch directly bypasses the unified
// pipeline contract.
// Expected: no-restricted-imports error.
import {
  exactNameMatch,
  tokenMatch,
  stringSimilarity,
  synonymMatch,
  embedMatch,
} from '@salt/domain';

// One statement, not one per symbol. These exist only to keep no-unused-vars
// quiet — the import above is the whole fixture — and this file sits inside a
// coverage-measured glob while being, by construction, never executed. Every
// extra top-level statement here is therefore a permanently uncovered line
// charged against `apps/cloud-functions/src/**`'s ratchet ceiling, which is how
// adding the fifth stage internal turned red (#971).
void [exactNameMatch, tokenMatch, stringSimilarity, synonymMatch, embedMatch];
