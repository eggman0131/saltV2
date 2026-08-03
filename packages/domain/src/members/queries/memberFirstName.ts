// Derive a member's first name from their full name. The first whitespace-
// separated word, or '' when there is nothing usable. Mirrors memberInitials'
// parsing of the single `name` field.
//
// LOAD-BEARING FOR DELIVERY, not just display (issue #680). Cook timers are
// routed to Pushover devices named `<firstname>-<phone|tablet|spare>`, and the
// send resolves a member's devices by matching this value (lowercased) as a
// prefix. So the cost of getting it wrong is a MISSED TIMER, not a wonky
// initial. Note the unenforced half of that convention: renaming a member
// ("Daniel Pendery" → "Dan Pendery") silently stops their devices matching —
// which is why the send refuses to fall back to a broadcast on a zero-match.
export function memberFirstName(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean)[0] ?? '';
}
