// Pure, I/O-free split of a manual shopping-list entry into a clean item name
// (fed to canon) and a trailing context note (kept on the shopping list only).
//
// Shopping-list-only concern: recipe-sourced items are clean by construction and
// manual canon-add is the user explicitly defining canon — neither calls this.
import { normaliseName } from '../../canon/index.js';

// Extensible by design: a future amount/unit feature adds *additive optional*
// fields here (e.g. `readonly amount?: string`) without reshaping callers, the
// EntryParsePort, the CF trigger, or existing tests. This parse function / the
// AI prompt is the single extension point for that future work — do not add a
// second parallel parse pass.
export interface ParsedEntry {
  // Clean item name, suitable to feed verbatim into the canon pipeline.
  readonly name: string;
  // Trailing context stripped off the entry ('' when nothing was stripped).
  readonly context: string;
}

// Broad trailing-`for` rule: split at the first standalone `for` and treat the
// remainder as context. Non-greedy name capture so the *first* `for` wins
// ("rice for risotto for friday" → name "rice"). `(.*?\S)` forces a non-empty
// name ending in a non-space; `\s+for\b\s+\S` requires `for` to be a whole word
// flanked by whitespace with real content after it, so "comfort food" and a
// trailing bare "card for " are left untouched.
const TRAILING_FOR = /^(.*?\S)(\s+for\b\s+\S.*)$/i;

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

export function parseShoppingListEntry(rawText: string): ParsedEntry {
  const trimmed = collapse(rawText);
  const match = TRAILING_FOR.exec(trimmed);
  if (match === null) {
    return { name: trimmed, context: '' };
  }

  // Groups 1 and 2 are non-optional in TRAILING_FOR, so a non-null match
  // guarantees both are present.
  const candidateName = collapse(match[1]!);
  // Safety fallback: if the strip leaves nothing canon could match on
  // ("4 for £1" → "4" → normalises to empty), keep the original entry intact.
  if (normaliseName(candidateName) === '') {
    return { name: trimmed, context: '' };
  }

  return { name: candidateName, context: collapse(match[2]!) };
}
