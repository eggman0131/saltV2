/** The three things that can ask something of you, in priority order. */
export type PersonalCardKind = 'unshopped-mine' | 'needs-check' | 'unshopped-other';

export interface RankableCard {
  readonly id: string;
  readonly kind: PersonalCardKind;
  /** The night it concerns, or null for a card about the list as a whole. */
  readonly date: string | null;
  /** The shop is today or tomorrow — this got more pressing. */
  readonly urgent: boolean;
}

/** Hard cap on the "Needs you" queue. */
export const PERSONAL_CARD_LIMIT = 3;

const KIND_RANK: Readonly<Record<PersonalCardKind, number>> = {
  'unshopped-mine': 0,
  'needs-check': 1,
  'unshopped-other': 2,
};

// The order and the cap for the "Needs you" queue (issue #634).
//
// Tier first, and absolutely: a night somebody else is cooking never outranks one
// of yours, however close the shop is. Urgency only reorders WITHIN a tier — the
// page is "what needs you", so promoting someone else's problem above your own on
// a timer would defeat the whole point of it.
//
// Within a tier: urgent first, then soonest night, then id — a total order, so the
// same inputs always produce the same three cards and the list never shuffles
// under a re-render.
//
// Pure — no clock (CLAUDE.md Rule 1): `urgent` is decided by the caller, which is
// also what keeps shop-proximity policy out of this ordering.
export function rankPersonalCards<T extends RankableCard>(
  cards: readonly T[],
  limit: number = PERSONAL_CARD_LIMIT,
): T[] {
  return [...cards]
    .sort(
      (a, b) =>
        KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
        Number(b.urgent) - Number(a.urgent) ||
        (a.date ?? '').localeCompare(b.date ?? '') ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}
