// Derive a member's first name from their full name. The first whitespace-
// separated word, or '' when there is nothing usable. Display-only — no
// storage. Mirrors memberInitials' parsing of the single `name` field.
export function memberFirstName(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean)[0] ?? '';
}
