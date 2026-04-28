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
