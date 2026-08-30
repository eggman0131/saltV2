import type { ProcessStageKind, StageDuration, StageEnvironment } from '../schemas/index.js';

// Structured diff between a formula's REFERENCE process and a proposed one
// (issue #812, phase 2 of epic #778). PURE data: `diffProcess`
// (packages/domain/src/process) produces it and it carries only human-signal
// changes, so the review screen can render a deterministic summary — "Bulk ferment
// 90 min → 20 min", "Added: Cold retard, 8 h at 4 °C", "Removed: Second rise".
// This type is a render contract, not a Firestore document: it is never
// persisted, so there is no back-compat surface. `recipeDiff.ts` is the precedent
// in every respect.
//
// PLAIN TYPES, NOT ZOD, AND THAT IS THE RULE RATHER THAN AN EXCEPTION TO IT
// (issue #973). CLAUDE.md's Zod conventions say validate at trust boundaries only.
// A diff is computed in-process by `diffProcess` from two arguments and handed
// straight to the review screen: it never arrives from a client, a model or
// Firestore, and it is never written back to any of them. There is no boundary
// here, so there is nothing to validate — and a schema whose `.parse()` is never
// called is validation machinery that only reads as though it runs. Every
// declaration below was a `z.object` until #973; each one still carries the comment
// it had then, and none of them gained or lost a field in the conversion.
// `resolveSchedule.ts` and `totalDuration.ts` in this same directory own their
// result types the same way.
//
// WHAT IS NOT DIFFED, and why:
//
//   • `stepId` — a machine-derived, one-way back-reference to the recipe step a
//     stage came from. `recipeDiff` ignores the same class of field (canonId,
//     matchState, ids-as-content) for the same reason: it is a key, not signal,
//     and nobody reviewing a schedule wants to be told a citation moved.
//   • `sourceStageId` — the proposal's claim about provenance. It is how the two
//     sides are MATCHED, so reporting it as a change would be reporting the
//     matcher's own workings.
//   • Pure reorders. A stage that moved but is otherwise identical matches and is
//     omitted, exactly as `recipeDiff` omits a moved-but-unchanged step:
//     add/remove/change clarity is what the summary is for.
//   • The leavening adjustment. It is a fact about the FORMULA, not the process,
//     and it rides on the flow's output where the review renders it beside these
//     stages. Folding it in here would make `diffProcess` need a formula.
//
// AND THERE IS NO `split` CASE. One stage becoming two — ninety minutes on the
// counter becoming twenty on the counter and eight in the fridge — is a REMOVAL
// PLUS TWO ADDITIONS, and renders honestly as that. Both the contract doc and the
// issue say so. A first-class split would need a shape that says which half is the
// "real" continuation, and there is no honest answer to that question.

// A change on a required string field (a stage's label). `from !== to` by
// construction.
export interface StageTextChange {
  from: string;
  to: string;
}

// A change on a nullable string field (`until`). null means "no criterion"; a
// null→string or string→null transition is a real change.
export interface StageNullableTextChange {
  from: string | null;
  to: string | null;
}

// `active` ⇄ `wait`. Rare, and worth shouting about when it happens: it is the
// difference between an evening you can leave the house for and one you cannot.
export interface StageKindChange {
  from: ProcessStageKind;
  to: ProcessStageKind;
}

// Where the stage happens. Nullable on both sides — a mix has no temperature, and
// moving a prove from the counter to the fridge is null→{4 °C} as often as it is
// {20 °C}→{4 °C}.
export interface StageEnvironmentChange {
  from: StageEnvironment | null;
  to: StageEnvironment | null;
}

// How long it takes. The WHOLE duration on each side, never a single number: a
// 45–60 minute prove becoming a fixed 30 is a range collapsing, and the review has
// to be able to say so.
export interface StageDurationChange {
  from: StageDuration | null;
  to: StageDuration | null;
}

// An added or removed stage.
//
// `id` is the reference stage's id for a REMOVAL and NULL for an ADDITION — a
// proposed stage has not been minted an id yet, because ids are document-local
// identity and belong to the write path (`batchService` / `formulaService`), not
// to a proposal. Nothing here invents one.
//
// `position` is 1-based: in the reference process for a removal, in the proposed
// process for an addition, so the review can say "stage 3". A positive integer by
// construction — it is `index + 1` over an array — which is what the `z.number()
// .int().positive()` it replaced asserted and never checked.
export interface ProcessStageDiffEntry {
  id: string | null;
  position: number;
  label: string;
}

// A stage the proposal kept and altered. `id` is the reference stage's — a change
// exists only where the two sides matched, so there is always one. `position` is
// 1-based in the PROPOSED process, which is where the reviewer will see it.
//
// Each facet is present only when that facet changed; at least one always is (a
// stage that changed in no facet is not a change and is omitted entirely).
export interface ProcessStageChange {
  id: string;
  position: number;
  label?: StageTextChange;
  kind?: StageKindChange;
  environment?: StageEnvironmentChange;
  duration?: StageDurationChange;
  until?: StageNullableTextChange;
}

// The full process diff. All three lists are always present (empty when nothing
// fell into them) so the render shape is stable. `hasChanges` is the single no-op
// signal: false ⟺ all three are empty — which is precisely how "the model declined
// to restructure, and was right to" reaches the screen.
export interface ProcessDiff {
  hasChanges: boolean;
  added: ProcessStageDiffEntry[];
  removed: ProcessStageDiffEntry[];
  changed: ProcessStageChange[];
}
