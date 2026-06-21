# Feature Spec

I want to build: $ARGUMENTS

## Step 1 — Architecture read
Spawn an Explore subagent to read CLAUDE.md, docs/salt-architecture.md, and any docs relevant to this feature. Return a concise summary of: which layers are involved, key constraints, relevant patterns.

## Step 2 — Clarify with user
Ask me clarifying questions about intended UX and outcomes. Surface any architecture risks I should decide upfront. Do not propose implementation yet.

## Step 3 — Draft and post the issue
Once we've agreed, post a GitHub issue.

**Issue metadata:**
- Title: `feat: <concise feature name>` (imperative, no trailing period)
- Labels: `feature'

**Issue body — use exactly this structure:**

---
## Intended Experience
[UX outcomes only. What the user will see and feel. Specific flows. What changes from today.
No implementation detail. Written for a non-coder deciding if this is right.]

## Architecture Notes
[Layer map references. Packages touched. Key decisions made. Constraints from CLAUDE.md.
What must NOT be done. Existing patterns to reuse. Written for a fresh agent with no prior context.]

## Open Questions / Decisions
[Every architecture risk or fork raised in Step 2 goes here, each as:
- **Decision:** what was chosen
- **Why:** the reasoning
- **Rejected:** the alternative(s) and why not
Unresolved items stay listed as open questions, not silently assumed away.
This section is the audit trail — the "why" that Architecture Notes does not hold.]

## Phases
[One `### Phase` block per phase, numbered Phase 1 through Phase N. Most features need 2+ phases;
a single-phase feature is the exception, not the default. Each phase must be independently
user-testable. Repeat the block below for every phase — do not collapse into one.]

### Phase 1: [Name]
**Scope:** [What gets built — precise, not vague]
**User-testable outcome:** [What the user can observe when this phase is done]
**Technical deliverables:** [Files, routes, Firestore paths, exported functions/types]
**Must not touch:** [Explicitly out of scope]

### Phase 2: [Name]
**Scope:** [...]
**User-testable outcome:** [...]
**Technical deliverables:** [...]
**Must not touch:** [...]

[...continue through Phase N...]

## Definition of Done
[User-perspective acceptance criteria for the complete feature]
---

After posting: share the issue URL and ask the user to confirm "Intended Experience" before any implementation starts. Do not write code.