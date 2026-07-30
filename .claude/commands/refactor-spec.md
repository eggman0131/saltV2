# Refactor Spec

I want to refactor: $ARGUMENTS

You are designing, not building. The deliverable is a GitHub issue. Do not write code.

## Standing rules

- **CLAUDE.md is binding** — and a refactor is the most likely place to quietly drift from it. Layer map, adapter rules, data-model and Zod conventions all hold across the move.
- **No bodges.** If the target shape can only be reached by bending a rule in CLAUDE.md, that is the finding: surface it in Step 2 and get agreement to change the rule, rather than shipping a structure that violates it.
- **Flag the simpler path.** If the honest answer is a *different* target shape than the one I asked for — or that the churn isn't worth it at all — say so with the trade-off. "Simpler and more maintainable" is the bar; "less work" is not.
- **GitHub through the `gh` CLI** (`gh issue list`, `gh issue create`, `gh label list`). There is no GitHub MCP server in this repo.

## Step 0 — Behavior-preserving?

State up front: is this a **pure refactor** (no intended behavior change) or a **refactor + change**?
If any intended behavior change is mixed in, split it out into a separate feature issue.
Mixing structural churn with behavior change is the classic way refactors go wrong — keep them apart.

## Step 1 — Architecture read

Read the target area and what surrounds it. CLAUDE.md's **Docs map** is the routing table: open the docs whose *Tracks* globs match the code you expect to move, plus `docs/salt-architecture.md` for anything crossing a layer boundary. Delegate breadth to Explore subagents when the target area is wide or its call sites are unknown; read directly when it's one module.

Note the repo's own trap here: Serena's semantic tools cannot see `.svelte` files, so "what consumes this?" answered by `find_referencing_symbols` alone is a confident, wrong answer for anything with UI call sites. Use `grep` over `**/*.svelte` for those, and treat `pnpm depcruise` / `pnpm typecheck` as the authority on what is actually connected.

Scope the output to five things and no others:

> 1. **Current structure** — what exists in the target area today, and which layers/packages it spans.
> 2. **Call sites** — everything that depends on it, `.svelte` included, with `file:line`.
> 3. **Existing coverage** — the tests over it now, and whether they are strong enough to prove behavior is preserved.
> 4. **Binding constraints** — the CLAUDE.md rules and doc contracts the target shape must honor, each named (rule number, `docs/…` section) rather than paraphrased.
> 5. **Riskiest cut points** — where this could go wrong mid-migration.
>
> No walkthrough of how the code works, no target-shape proposal yet.

## Step 2 — Clarify with user

Ask about: the trigger (why now), the desired end state, blast-radius tolerance, and whether old and new must coexist during migration. Put the riskiest cut points in front of me before they get baked in — `AskUserQuestion` where the options are discrete, prose where they're open-ended. Do not propose implementation yet.

If the refactor adds or drops a dependency, check what is actually published (`npm view <pkg> version`) before it reaches the issue — never a version from memory.

## Step 3 — Draft and post the issue

Once we've agreed, post it with `gh issue create`.

**Issue metadata:**
- Title: `refactor: <concise target>` (imperative, no trailing period)
- Labels: `refactor`, plus the area labels that fit (`gh label list` — e.g. `domain`, `area: web-pwa`, `tech-debt`, `architecture` when the layer map moves, `breaking-change` when back-compat is at stake)

**Issue body — use exactly this structure.** `/run` consumes these headings; the phase blocks are its scope contract.

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
Constraints from CLAUDE.md. Written for a fresh agent with no prior context.]

## Open Questions / Decisions
[Every cut-point or risk raised in Step 2, each as:
- **Decision:** what was chosen
- **Why:** the reasoning
- **Rejected:** the alternative(s) and why not
Unresolved items stay listed as open questions, not silently assumed away.]

## Phases
[One `### Phase` block per phase, numbered Phase 1 through Phase N.

Every phase must end behavior-preserving and verifiable — that is a constraint on where a boundary may
*fall*. Unlike a feature, a refactor's boundaries are genuinely driven by structure: the useful question
is **"where can we safely stop?"**, and each such resting point is worth a phase even when the work either
side is small. A phase whose preservation can't be verified is a red flag, not a phase.

Split at:
- **safe resting points** — the codebase is consistent and shippable here, old and new coexisting if need be;
- **characterization-first** — locking current behavior in tests before moving anything is its own phase
  whenever existing coverage isn't strong enough to prove preservation;
- **a mechanical sweep** — a wide call-site migration separates cleanly from the structural change it follows;
- **dead-code removal** — deleting the old shape after the new one is proven, never in the same phase.

Do not split a single atomic move that has no safe midpoint — say so in **Safe to stop here?** instead.]

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
(tests/types/lint/depcruise) green. Any dead code from the old structure removed or explicitly scheduled.]
---

After posting: share the issue URL and ask me to confirm the **Behavior Contract** before any
implementation starts.
