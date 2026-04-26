// Pure normalisation used by both lookup and matching logic.
export function normaliseName(rawName: string): string {
  return rawName.trim().toLowerCase();
}
