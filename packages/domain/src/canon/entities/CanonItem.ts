// Canon entity: a canonical ingredient definition.
// Lives in canon/entities — internal to the canon module.
// Other modules access it only via the published index (re-exported as a type).
export interface CanonItem {
  readonly id: string;
  readonly name: string;
  readonly synonyms: readonly string[];
  readonly aisleId: string | null;
  readonly thumbnail: string | null;
  readonly embedding: readonly number[] | null;
  readonly needs_approval: boolean;
}
