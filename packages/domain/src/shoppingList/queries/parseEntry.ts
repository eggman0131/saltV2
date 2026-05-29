// Pure, I/O-free split of a manual shopping-list entry into a clean item name
// (fed to canon) and a trailing context note (kept on the shopping list only).
//
// Shopping-list-only concern: recipe-sourced items are clean by construction and
// manual canon-add is the user explicitly defining canon — neither calls this.
import { normaliseName } from '../../canon/index.js';

export interface ParsedEntry {
  // Clean item name, suitable to feed verbatim into the canon pipeline.
  readonly name: string;
  // Trailing context stripped off the entry ('' when nothing was stripped).
  readonly context: string;
  // Structured quantity — absent when no quantity was found.
  readonly amount?: number;
  // Unit of the quantity — absent when no recognised unit was extracted.
  // Stored with original casing; normalisation for grouping is display-time only.
  readonly unit?: string;
}

// Broad trailing-`for` rule: split at the first standalone `for` and treat the
// remainder as context. Non-greedy name capture so the *first* `for` wins
// ("rice for risotto for friday" → name "rice"). `(.*?\S)` forces a non-empty
// name ending in a non-space; `\s+for\b\s+\S` requires `for` to be a whole word
// flanked by whitespace with real content after it, so "comfort food" and a
// trailing bare "card for " are left untouched.
const TRAILING_FOR = /^(.*?\S)(\s+for\b\s+\S.*)$/i;

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

// Standard measurement units for the space-separated case ("2 kg …").
// Number-attached alpha ("2kg …") is matched structurally — no whitelist needed.
const UNIT_WORDS = new Set([
  'kg',
  'g',
  'mg',
  'lb',
  'lbs',
  'oz',
  'l',
  'ml',
  'cl',
  'dl',
  'litre',
  'litres',
  'liter',
  'liters',
  'tsp',
  'tbsp',
  'cup',
  'cups',
  'pint',
  'pints',
]);

// ─── Leading quantity patterns ────────────────────────────────────────────────

// "<number><alphas> <rest>" — number directly attached to a unit (e.g. "2kg flour")
const ATTACHED_UNIT = /^(\d+(?:\.\d+)?)([a-zA-Z]+) (\S.*)$/;
// "<number> <rest>" — bare leading number with at least one following word
const LEADING_NUMBER = /^(\d+(?:\.\d+)?) (\S.*)$/;
// "<word-number> <rest>" — English cardinal words one–twelve, plus the article "a" (= 1)
const LEADING_WORD_NUMBER =
  /^(a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) (\S.*)$/i;
const WORD_NUMBER_VALUES: Record<string, number> = {
  a: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

// ─── Trailing quantity patterns ───────────────────────────────────────────────

// "<name> <N><unit>" — unit directly attached to trailing number, e.g. "cucumber 400g"
const TRAILING_ATTACHED_UNIT = /^(.+) (\d+(?:\.\d+)?)([a-zA-Z]+)$/;
// "<name> <N> <unit>" — space-separated trailing unit from the known whitelist
const TRAILING_SPACE_UNIT = /^(.+) (\d+(?:\.\d+)?) ([a-zA-Z]+)$/;
// "<name> <N>" — bare trailing count, e.g. "onions 3"
const TRAILING_NUMBER_ONLY = /^(.+) (\d+(?:\.\d+)?)$/;

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface QuantityResult {
  readonly amount: number;
  readonly unit?: string;
  readonly remainder: string;
}

interface TrailingQuantityResult {
  readonly amount: number;
  readonly unit?: string;
  readonly name: string;
}

// Strip a leading "of " that connects a unit to its item name (e.g. "rashers of
// bacon" → after extracting "rashers", remainder is "of bacon" → strip to "bacon").
function stripLeadingOf(s: string): string {
  return /^of\s+/i.test(s) ? s.replace(/^of\s+/i, '') : s;
}

function extractLeadingQuantity(text: string): QuantityResult | null {
  // Case 0: leading English word-number, e.g. "one cucumber" or "three onions"
  const wordMatch = LEADING_WORD_NUMBER.exec(text);
  if (wordMatch !== null) {
    const remainder = wordMatch[2]!;
    if (/^for\s/i.test(remainder)) return null;
    return {
      amount: WORD_NUMBER_VALUES[wordMatch[1]!.toLowerCase()]!,
      remainder: stripLeadingOf(remainder),
    };
  }

  // Case 1: number directly attached to alpha unit, e.g. "2kg flour"
  const attachedMatch = ATTACHED_UNIT.exec(text);
  if (attachedMatch !== null) {
    const remainder = attachedMatch[3]!;
    // "<N>X for …" is price notation ("2for£1" would be odd but guard anyway)
    if (/^for\s/i.test(remainder)) return null;
    return {
      amount: parseFloat(attachedMatch[1]!),
      unit: attachedMatch[2]!,
      remainder: stripLeadingOf(remainder),
    };
  }

  // Case 2: bare leading number, e.g. "3 onions" or "2 kg potatoes"
  const numMatch = LEADING_NUMBER.exec(text);
  if (numMatch === null) return null;

  const amount = parseFloat(numMatch[1]!);
  const rest = numMatch[2]!;

  // "N for …" is price notation ("4 for £1"), not a quantity
  if (/^for\s/i.test(rest)) return null;

  // Check whether the first word of rest is a known measurement unit
  const spaceIdx = rest.indexOf(' ');
  if (spaceIdx !== -1) {
    const firstWord = rest.slice(0, spaceIdx);
    if (UNIT_WORDS.has(firstWord.toLowerCase())) {
      return { amount, unit: firstWord, remainder: stripLeadingOf(rest.slice(spaceIdx + 1)) };
    }
  }

  // No recognised unit — bare count; strip leading "of " if present
  return { amount, remainder: stripLeadingOf(rest) };
}

function extractTrailingQuantity(text: string): TrailingQuantityResult | null {
  // Case 1: number directly attached to trailing unit, e.g. "cucumber 400g"
  const attachedMatch = TRAILING_ATTACHED_UNIT.exec(text);
  if (attachedMatch !== null) {
    return {
      name: attachedMatch[1]!,
      amount: parseFloat(attachedMatch[2]!),
      unit: attachedMatch[3]!,
    };
  }

  // Case 2: space-separated trailing unit from the known whitelist, e.g. "potatoes 1 kg"
  const spaceMatch = TRAILING_SPACE_UNIT.exec(text);
  if (spaceMatch !== null && UNIT_WORDS.has(spaceMatch[3]!.toLowerCase())) {
    return {
      name: spaceMatch[1]!,
      amount: parseFloat(spaceMatch[2]!),
      unit: spaceMatch[3]!,
    };
  }

  // Case 3: bare trailing count, e.g. "onions 3"
  const numMatch = TRAILING_NUMBER_ONLY.exec(text);
  if (numMatch !== null) {
    return { name: numMatch[1]!, amount: parseFloat(numMatch[2]!) };
  }

  return null;
}

// ─── Public entry point ───────────────────────────────────────────────────────

export function parseShoppingListEntry(rawText: string): ParsedEntry {
  const trimmed = collapse(rawText);

  // Step 1: try leading quantity
  const leading = extractLeadingQuantity(trimmed);
  let workingText = leading !== null ? leading.remainder : trimmed;
  let amount = leading?.amount;
  let unit = leading?.unit;

  // Safety fallback: if leading extraction leaves an empty normalised name, discard it
  if (leading !== null && normaliseName(workingText) === '') {
    workingText = trimmed;
    amount = undefined;
    unit = undefined;
  }

  // Step 2: apply trailing-`for` rule to get final name and context
  const forMatch = TRAILING_FOR.exec(workingText);
  let finalName: string;
  let context: string;

  if (forMatch === null) {
    finalName = workingText;
    context = '';
  } else {
    const candidateName = collapse(forMatch[1]!);
    // Safety fallback: if the strip leaves nothing canon could match on
    // ("4 for £1" → "4" → normalises to empty), keep the working text intact.
    if (normaliseName(candidateName) === '') {
      finalName = workingText;
      context = '';
    } else {
      finalName = candidateName;
      context = collapse(forMatch[2]!);
    }
  }

  // Step 3: if no leading quantity was found, try trailing quantity on the final name
  if (amount === undefined) {
    const trailing = extractTrailingQuantity(finalName);
    if (trailing !== null && normaliseName(trailing.name) !== '') {
      amount = trailing.amount;
      unit = trailing.unit;
      finalName = trailing.name;
    }
  }

  return {
    name: finalName,
    context,
    ...(amount !== undefined ? { amount } : undefined),
    ...(unit !== undefined ? { unit } : undefined),
  };
}
