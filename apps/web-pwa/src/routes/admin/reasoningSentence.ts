import { ARBITRATION_FAILED_REASONING, ARBITRATION_NO_MATCH_REASONING } from '@salt/domain';

/**
 * `CanonItem.reasoning` normally holds the arbitrator's own words, which read
 * fine as-is. Two values are not words at all but review-queue sentinels written
 * by `matchOrCreate` — shown raw they tell the reader about our pipeline rather
 * than about their item, so those two become sentences.
 *
 * Shared by the record editor and the catalog's expanded review row (issue #872)
 * so the two cannot drift into telling the same reader two different things.
 */
export function reasoningSentence(reasoning: string): string {
  if (reasoning === ARBITRATION_FAILED_REASONING) {
    return "The AI couldn't be reached, so this was kept exactly as it was typed. Check the name and aisle.";
  }
  if (reasoning === ARBITRATION_NO_MATCH_REASONING) {
    return "The AI didn't recognise this as an existing item, so it was kept exactly as it was typed. Check the name and aisle.";
  }
  return reasoning;
}
