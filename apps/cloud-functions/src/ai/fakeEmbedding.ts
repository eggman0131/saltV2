// ─────────────────────────────────────────────────────────────────────────────
// E2E embedding fake seam (issue #686).
//
// The Genkit *embedder* has no `flowModel`-style fake — that seam swaps chat
// models only — so the site that calls `ai.embed()` short-circuits by hand
// under FUNCTIONS_AI_FAKE. That is the single-text flow (`embedText`) and, as
// of #935, only it: the batch adapter path (`computeEmbeddings`) inherits this
// seam by delegating to that flow per text rather than embedding inline, so it
// no longer carries a short-circuit of its own. A real embed call under the
// flag reaches
// generativelanguage.googleapis.com with the dummy emulator key, which is a fast
// 400 in CI and a 20s `withAiTimeout` stall wherever egress is slower — either
// way a live network dependency inside a suite that is meant to be hermetic.
//
// The vector is DERIVED FROM THE TEXT, not a constant. Canon items are embedded
// through this same fake, so a constant would score cosine 1.0 against every
// stored vector and stage 5 would bind any otherwise-unmatched name to an
// arbitrary canon item. Signed values over 64 dimensions put unrelated texts
// near-orthogonal (|cosine| concentrated well inside ±0.5, against
// stage5Stop = 0.75), while the same text always yields the same vector — so the
// embedding write-back and match paths stay exercised, deterministically and
// offline.
//
// Any length is schema-valid (`CanonItemSchema.embedding` is
// `z.array(number).nullable`) and no e2e spec compares embedding values.
// Unreachable in production: the flag is never set there.
// ─────────────────────────────────────────────────────────────────────────────

const DIMENSIONS = 64;

/** Deterministic stand-in vector for `text`. Test-only — see the note above. */
export function fakeEmbedding(text: string): number[] {
  // FNV-1a over the text, then xorshift32 from that seed for the components.
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  }

  let state = hash >>> 0 || 1;
  const values: number[] = [];
  for (let i = 0; i < DIMENSIONS; i++) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    values.push((state / 0xffffffff) * 2 - 1);
  }
  return values;
}
