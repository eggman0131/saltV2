/** A recognised chat command. There is exactly one, and this is deliberate. */
export interface ChatCommand {
  readonly kind: 'remember';
  /**
   * What to remember, trimmed. EMPTY when the line was a bare `/remember` — the
   * parser reports what was typed and lets the caller decide what that means.
   */
  readonly text: string;
}

const COMMAND = '/remember';

/**
 * Read a composer line as a command, or as an ordinary message to the chef.
 *
 * The decision this module holds is what counts as the command AT ALL — and the
 * whole point is that it is decided by reading characters, not by asking a model.
 * Capture costs a string comparison and a Firestore write; there is no classifier
 * anywhere on this path, no flow, no per-turn spend.
 *
 * Three rules, each of which is a judgement rather than an implementation detail:
 *
 *  - An EMPTY remainder is reported, not rejected. `{ kind: 'remember', text: '' }`
 *    says "they meant the command and gave it nothing", which is the only shape in
 *    which the UI can answer in place ("write something after /remember") instead
 *    of quietly forwarding the word `/remember` to the chef. Whether empty is an
 *    error is a question about a screen, and screens are not the domain's business.
 *
 *  - The word must END. `/rememberings are lovely` is a sentence that happens to
 *    start with the same nine characters; the character after the command has to be
 *    whitespace or nothing at all.
 *
 *  - The match is CASE-INSENSITIVE. `/` opens the line, so phone keyboards apply
 *    sentence-start auto-capitalisation and produce `/Remember …` routinely. A
 *    case-sensitive match would send that to the chef — costing a model call and
 *    saving nothing — and read as the feature simply not working. Nothing else
 *    about the match is loose: the remainder is preserved exactly as typed, minus
 *    surrounding whitespace.
 */
export function parseChatCommand(text: string): ChatCommand | null {
  const line = text.trim();
  if (line.slice(0, COMMAND.length).toLowerCase() !== COMMAND) return null;
  const remainder = line.slice(COMMAND.length);
  if (remainder !== '' && !/^\s/u.test(remainder)) return null;
  return { kind: 'remember', text: remainder.trim() };
}
