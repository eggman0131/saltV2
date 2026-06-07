// Derive an initials avatar label from a member's name (issue #155).
// Up to two uppercased initials: first letters of the first and last
// whitespace-separated words. Falls back to the first two characters of a
// single word, or '?' when there is nothing usable. Display-only — no storage.
export function memberInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) {
    return words[0]!.slice(0, 2).toUpperCase();
  }
  const first = words[0]![0]!;
  const last = words[words.length - 1]![0]!;
  return (first + last).toUpperCase();
}
