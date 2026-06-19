# Defect Spec

I want to investigate and fix: $ARGUMENTS

## When to use this
This is the heavyweight path — Explore agents, a tracked issue, the decision audit trail. It earns its weight only when at least one is true:
- the root cause is non-obvious and needs tracing across files/packages to locate;
- there is a real scope fork the user should decide (targeted vs broad, hotfix vs full fix);
- blast radius matters — production data may already be corrupted, or a behavior contract changes;
- it needs a tracked issue anyway (CLAUDE.md issue-first: new deps, layer-map edits, cross-package refactors).

If the cause is obvious, the change is contained to a file or two, and there is no decision for the user to make, **do not run this** — just fix it inline (with a regression test) and report. When unsure, say so and ask before spinning up the full flow.

## Step 1 — Reproduce & triage
Confirm the defect is real before theorising. Reproduce it (run the failing test, the command, the flow) and capture concrete evidence — error text, a failing assertion, a log line, a trace. Then state plainly:
- **Is it a real defect, a flake, or intended behavior?** If intermittent, characterize frequency. If the "buggy" behavior turns out to be intended, stop and report that instead of inventing a fix.
- **First-guess severity / blast radius:** who or what is affected, and is any production data being corrupted while the bug is live?

Do not propose a fix yet.

## Step 2 — Root-cause investigation
Trace the symptom to the mechanism in code. Spawn Explore subagents for breadth when the trail crosses files or packages. Report:
- The exact code path with `file:line` references and the precise mechanism — quote the code.
- Whether **more than one** bug contributes (investigations often surface a second).
- **Behavior that must be preserved** — adjacent correct behavior the fix must not regress, and the tests that encode it.
- Constraints from CLAUDE.md / docs that bound the fix (layers, purity, schema/back-compat).

Verify the root cause empirically where you can (a probe, or a test that pinpoints it) rather than asserting it.

## Step 3 — Clarify with user
Ask me to decide the forks the investigation surfaced. Typical ones:
- **Fix scope** — minimal/targeted vs a broader retune of the surrounding logic.
- **Existing data** — does live/production data already need remediation, or fix-forward only?
- **Urgency** — minimal hotfix now vs the full fix.

Surface the regression risks. Do not propose implementation detail yet.

## Step 4 — Draft and post the issue
Once we've agreed, post a GitHub issue.

**Issue metadata:**
- Title: `fix: <concise defect description>` (imperative, no trailing period)
- Labels: `bug` (plus area labels, e.g. `canon`, `domain`)

**Issue body — use exactly this structure:**

---
## Observed vs Expected
**Observed:** [The symptom, concretely, with a real example. Written so a non-coder recognises it.]
**Expected:** [What should happen instead.]

## Reproduction
[Smallest reliable steps / command / test that shows the defect. Note frequency if intermittent.]

## Root Cause
[The mechanism, with `file:line` references and quoted code. If multiple bugs contribute, list each.
Written for a fresh agent: enough to find and understand the fault without re-investigating.]

## Blast Radius
[What else the same mechanism affects. Is production data already corrupted — and if so, what would
remediation require? What is the risk of NOT fixing.]

## Architecture Notes & Constraints
[Layer map references, packages touched, constraints from CLAUDE.md (purity, schema/back-compat).
**Behavior that must be preserved**, and the tests that encode it. What must NOT be done.
Written for a fresh Sonnet agent.]

## Open Questions / Decisions
[Every fork raised in Step 3, each as:
- **Decision:** what was chosen
- **Why:** the reasoning
- **Rejected:** the alternative(s) and why not
Unresolved items stay listed as open questions, not silently assumed away. This is the audit trail.]

## Phases
[One `### Phase` block per phase. A defect almost always pairs the fix with a regression test in
Phase 1; add a docs phase when a behavior contract changes, and a data-remediation phase only if
Step 3 chose to remediate. Repeat the block for every phase — do not collapse into one.]

### Phase 1: [Name]
**Scope:** [What gets changed — precise, not vague]
**Verifiable outcome:** [What proves it is fixed — ideally a regression test that fails before the change and passes after]
**Technical deliverables:** [Files, functions, tests]
**Must not touch:** [Explicitly out of scope; the preserved behavior]

### Phase 2: [Name]
**Scope:** [...]
**Verifiable outcome:** [...]
**Technical deliverables:** [...]
**Must not touch:** [...]

[...continue through Phase N...]

## Definition of Done
[Checkable acceptance criteria: the defect no longer reproduces; a regression test guards it;
preserved behavior stays green; no schema/data regressions.]
---

After posting: share the issue URL and ask me to confirm the **Root Cause and Fix Approach** before any implementation starts. Do not write code.
