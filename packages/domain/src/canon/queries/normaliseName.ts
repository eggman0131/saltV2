const WORD_NUMBERS = new Set([
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
]);

// Pure normalisation used by both lookup and matching logic.
export function normaliseName(rawName: string): string {
  return rawName
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
    .replace(/-/g, ' ') // hyphens become spaces
    .replace(/[^a-z0-9\s]/g, '') // remove remaining punctuation
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim()
    .split(' ')
    .filter(Boolean)
    .filter(
      (word) =>
        !/^\d+$/.test(word) && // strip pure digit tokens: "3", "400"
        !WORD_NUMBERS.has(word) && // strip word-number tokens: "one", "two"
        !/^\d+[a-zA-Z]+$/.test(word), // strip digit-prefixed tokens: "400g", "2kg"
    )
    .map(singularize)
    .join(' ');
}

function singularize(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y'; // berries→berry
  if (word.endsWith('oes')) return word.slice(0, -2); // tomatoes→tomato
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}
