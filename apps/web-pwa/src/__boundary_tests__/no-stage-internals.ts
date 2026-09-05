// @ts-nocheck — boundary fixture; ESLint must flag this import even when the
// named symbols are not part of the @salt/domain public surface.
//
// VIOLATION: web-pwa must reach canon matching stages only via findClosestMatch
// (or matchOrCreate). Calling exactNameMatch / tokenMatch / stringSimilarity /
// synonymMatch / embedMatch directly bypasses the unified pipeline contract.
// Expected: no-restricted-imports error.
import {
  exactNameMatch,
  tokenMatch,
  stringSimilarity,
  synonymMatch,
  embedMatch,
} from '@salt/domain';

// One statement, not one per symbol — kept identical to the cloud-functions
// twin, which needs it for the coverage reason recorded there.
void [exactNameMatch, tokenMatch, stringSimilarity, synonymMatch, embedMatch];
