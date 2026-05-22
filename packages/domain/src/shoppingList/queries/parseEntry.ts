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
  // Structured quantity — absent when no unambiguous leading number was found.
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

// "<number><alphas> <rest>" — number directly attached to a unit (e.g. "2kg flour")
const ATTACHED_UNIT = /^(\d+(?:\.\d+)?)([a-zA-Z]+)\s+(.+)$/;
// "<number> <rest>" — bare leading number with at least one following word
const LEADING_NUMBER = /^(\d+(?:\.\d+)?)\s+(.+)$/;

interface QuantityResult {
  readonly amount: number;
  readonly unit?: string;
  readonly remainder: string;
}

function extractQuantity(text: string): QuantityResult | null {
  // Case 1: number directly attached to alpha unit, e.g. "2kg flour"
  const attachedMatch = ATTACHED_UNIT.exec(text);
  if (attachedMatch !== null) {
    const remainder = attachedMatch[3]!;
    // "<N>X for …" is price notation ("2for£1" would be odd but guard anyway)
    if (/^for\s/i.test(remainder)) return null;
    return { amount: parseFloat(attachedMatch[1]!), unit: attachedMatch[2]!, remainder };
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
      return { amount, unit: firstWord, remainder: rest.slice(spaceIdx + 1) };
    }
  }

  // No recognised unit — bare count; entire rest is the name
  return { amount, remainder: rest };
}

export function parseShoppingListEntry(rawText: string): ParsedEntry {
  const trimmed = collapse(rawText);

  const qty = extractQuantity(trimmed);
  let workingText = qty !== null ? qty.remainder : trimmed;
  let amount = qty?.amount;
  let unit = qty?.unit;

  // Safety fallback: if extraction leaves a name that normalises to empty,
  // discard the quantity and keep the full entry intact
  if (qty !== null && normaliseName(workingText) === '') {
    workingText = trimmed;
    amount = undefined;
    unit = undefined;
  }

  // Apply trailing-`for` rule to the remaining name
  const match = TRAILING_FOR.exec(workingText);
  if (match === null) {
    return {
      name: workingText,
      context: '',
      ...(amount !== undefined ? { amount } : undefined),
      ...(unit !== undefined ? { unit } : undefined),
    };
  }

  // Groups 1 and 2 are non-optional in TRAILING_FOR, so a non-null match
  // guarantees both are present.
  const candidateName = collapse(match[1]!);
  // Safety fallback: if the strip leaves nothing canon could match on
  // ("4 for £1" → "4" → normalises to empty), keep the working text intact.
  if (normaliseName(candidateName) === '') {
    return {
      name: workingText,
      context: '',
      ...(amount !== undefined ? { amount } : undefined),
      ...(unit !== undefined ? { unit } : undefined),
    };
  }

  return {
    name: candidateName,
    context: collapse(match[2]!),
    ...(amount !== undefined ? { amount } : undefined),
    ...(unit !== undefined ? { unit } : undefined),
  };
}
