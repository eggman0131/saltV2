// @ts-nocheck — boundary fixture; ESLint must flag this import even when the
// named symbols are not part of the @salt/domain public surface.
//
// VIOLATION: cloud-functions must reach canon matching stages only via
// findClosestMatch (or matchOrCreate). Calling tokenMatch / stringSimilarity
// / synonymMatch / embedMatch directly bypasses the unified pipeline contract.
// Expected: no-restricted-imports error.
import { tokenMatch, stringSimilarity, synonymMatch, embedMatch } from '@salt/domain';

void tokenMatch;
void stringSimilarity;
void synonymMatch;
void embedMatch;
