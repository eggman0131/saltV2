// What `--verify` is entitled to fail on (issue #1248). The script self-executes
// on import — it parses argv, reaches `gcloud` and the network at top level — so
// the verdict is pulled out here where a test can reach it, the same reason
// scripts/lib/recipeTimesEstimated.mjs and scripts/lib/recipePhaseStrip.mjs
// exist (their own headers explain why).
//
// ─── Why the arithmetic check is gone ─────────────────────────────────────────
//
// Until #1248 the verdict also required `total >= prep + cook` over the stored
// `metadata.prepTimeMinutes` / `cookTimeMinutes` / `totalTimeMinutes`. #1233
// stopped `onRecipeWritten` writing those three fields and #1211 deleted them
// from `RecipeMetadataSchema`, so nothing produces them any more — but documents
// written before then still carry them, some arithmetically impossible (Paneer
// Makhanwala: prep 10, cook 35, total 35). A gate on those values could not be
// cleared by any run of this script, or by any other action short of a write
// this issue forbids, so `--verify` exited 1 on every environment holding a
// legacy document with nothing an operator could do about it.
//
// Those values are inert leftovers. LWW per whole document clears them on the
// next ordinary save (CLAUDE.md → Data model conventions), which is the whole of
// the migration #1211 accepted. This script neither reads nor writes them.
//
// ─── The claim this makes, and its boundary ───────────────────────────────────
//
// A `false` verdict means at least one cookable recipe in THIS project is either
// unstamped or strip-less — both of which a documented run can change (the
// default pass stamps; `--missing-phases` fills the strip). It says nothing
// about the other two environments, and nothing about whether a strip is any
// GOOD — only that one is stored. `recipeTimesVerdict.test.mjs` pins that the
// verdict reads nothing but those two facts, and that the script's source names
// none of the three retired keys.

/**
 * The `--verify` verdict over the cookable recipes of one project.
 *
 * `cookable` entries need exactly two properties — `estimated` (the
 * `timesEstimatedAt >= timesRequestedAt` rule from
 * scripts/lib/recipeTimesEstimated.mjs) and `hasStrip` (the "has a phase strip"
 * rule from scripts/lib/recipePhaseStrip.mjs). Anything else on them is ignored,
 * deliberately: see the header.
 *
 * Returns the two outstanding lists, so the caller can print them by id, and
 * `ok` — the sole input to the exit code.
 */
export function recipeTimesVerdict(cookable) {
  const pending = cookable.filter((r) => !r.estimated);
  const noStrip = cookable.filter((r) => !r.hasStrip);
  return { pending, noStrip, ok: pending.length === 0 && noStrip.length === 0 };
}
