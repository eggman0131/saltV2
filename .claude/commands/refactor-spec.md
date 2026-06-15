# Refactor Spec

I want to refactor: $ARGUMENTS

## Step 0 — Behavior-preserving?
State up front: is this a **pure refactor** (no intended behavior change) or a **refactor + change**?
If any intended behavior change is mixed in, split it out into a separate feature issue.
Mixing structural churn with behavior change is the classic way refactors go wrong — keep them apart.

## Step 1 — Architecture read
Spawn an Explore subagent to read CLAUDE.md, docs/salt-architecture.md, and the code under refactor.
Return: current structure of the target area, which layers/packages it spans, existing test coverage
over it, and the patterns/constraints that must be honored.

## Step 2 — Clarify with user
Ask me about: the trigger (why now), the desired end state, blast-radius tolerance, and whether old and
new must coexist during migration. Surface the riskiest cut points I should decide upfront.
Do not propose implementation yet.

## Step 3 — Draft and post the issue
Once we've agreed, post a GitHub issue.

**Issue metadata:**
- Title: `refactor: <concise target>` (imperative, no trailing period)
- Labels: `refactor` (add any standing labels the repo uses)

**Issue body — use exactly this structure:**

---
## Current State & Motivation
[What exists today and what's wrong with it. The cost of leaving it as-is. The target shape.
Decider-facing: written so a non-coder can judge whether this churn is worth it and the target is right.
NOT a UX description — a refactor changes structure, not what the user sees.]

## Behavior Contract
[The observable behavior that MUST be identical before and after, end to end.
This is the invariant the entire refactor is judged against.
If pure refactor: "no observable behavior changes." If refactor + change: that change lives in a
separate issue, linked here, not performed in this one.]

## Verification Strategy
[How behavior-preservation is PROVEN, per phase. Pick and state: existing coverage is sufficient /
characterization tests written first to lock current behavior / parity or snapshot check / manual
parity steps. This governs every phase below — a phase whose preservation can't be verified is a
red flag, not a phase.]

## Architecture Notes
[Target-state layer map. Packages touched. Migration approach: in-place / parallel-implementation
behind a flag / strangler (incremental call-site migration). Existing patterns to reuse.
Constraints from CLAUDE.md. Written for a fresh Sonnet agent.]

## Open Questions / Decisions
[Every cut-point or risk raised in Step 2, each as:
- **Decision:** what was chosen
- **Why:** the reasoning
- **Rejected:** the alternative(s) and why not
Unresolved items stay listed as open questions, not silently assumed away.]

## Phases
[One `### Phase` block per phase, numbered Phase 1 through Phase N. Each phase must be independently
shippable AND behavior-preserving — old and new can coexist between phases if needed. Repeat the block
for every phase; do not collapse into one.]

### Phase 1: [Name]
**Scope:** [What gets restructured — precise, not vague]
**Behavior-preserving check:** [How this phase proves behavior is unchanged — which tests, which parity check]
**Technical deliverables:** [Files moved/split/renamed, new boundaries, exported functions/types]
**Must not touch:** [Explicitly out of scope]
**Safe to stop here?:** [Yes/No — is the codebase in a shippable, consistent state after this phase, or is this a point of no return mid-migration?]

### Phase 2: [Name]
**Scope:** [...]
**Behavior-preserving check:** [...]
**Technical deliverables:** [...]
**Must not touch:** [...]
**Safe to stop here?:** [...]

[...continue through Phase N...]

## Definition of Done
[Structural goal reached AND behavior unchanged per the Behavior Contract AND mechanical gates
(tests/types/lint) green. Any dead code from the old structure removed or explicitly scheduled.]
---

After posting: share the issue URL and ask the user to confirm the **Behavior Contract** before any
implementation starts. Do not write code.