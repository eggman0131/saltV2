# Run Issue

Argument: $ARGUMENTS → ISSUE_NUMBER

You are the orchestrator. You do not write code or read files directly.
You spawn subagents, validate their output, and maintain the handoff chain.

---

## Setup (once)

Read GitHub issue #ISSUE_NUMBER in full.
Extract and hold:
- "Intended Experience" section verbatim (your UX validation baseline)
- Phase list: names, scopes, must-not-touch lists, user-testable outcomes
- Total phase count and which phase is the final one

Do not re-read the issue during execution. Your held copy is authoritative.

### Create the working branch (once, before phase 1)

From the current branch, create and check out a new branch for this issue:

```
git checkout -b <type>/<slug>-ISSUE_NUMBER
```

- `<type>` matches the change's nature using the repo convention: `feat`, `fix`, `chore`, `docs`, or `perf`.
- `<slug>` is a short kebab-case summary derived from the issue title (≤4 words).
- Example: issue #261 "Add meal-planner drag reorder" → `feat/meal-planner-drag-reorder-261`.

If the current branch is already a dedicated branch for this issue (it contains `-ISSUE_NUMBER`), reuse it instead of nesting a new one. Never run phases directly on `main` — if `HEAD` is `main`, you must create the branch first.

All phase commits land on this branch. Hold its name; you need it for the PR at the end.

---

## Per-phase loop (N = 1 to final)

### 1. Architecture context (Explore subagent)

Spawn with this brief:
"Read CLAUDE.md and the files most likely to be modified by: [Phase N technical deliverables].
Return ≤300 words covering: which packages/layers are involved, relevant constraints from CLAUDE.md,
existing functions/patterns to reuse or respect. Nothing else."

### 2. Implementation (claude subagent, isolation: "worktree")

Pass only:
- Phase N spec (scope, deliverables, must-not-touch) — NOT the full issue
- Architecture summary from step 1
- Previous handoff contract (step 4 output from phase N-1; omit for phase 1)

Instruct the subagent:
"Implement exactly what is in scope. Do not read or implement any other phase.
Make technical decisions autonomously — CLAUDE.md is your guide.
Do NOT post GitHub comments or commit.
When done, return a structured report:
  BUILT: [bullet list of what was implemented]
  DECISIONS: [any choice not specified in scope, and why]
  UX_DELTA: [anything that differs from 'user-testable outcome' — or NONE]
  FLAGS: [anything the next phase must know that isn't in the scope — or NONE]"

Wait for the subagent to complete and return the report.

### 3. Validation

Check the report against:
- Phase N "Technical deliverables" — are all present in BUILT?
- Phase N "Must not touch" — does BUILT include anything from this list?
- Phase N "User-testable outcome" vs UX_DELTA

If must-not-touch was violated or deliverables are missing: do NOT merge. Post a comment on the issue describing the gap, then stop and wait for user input.

If UX_DELTA is non-empty: proceed to step 5 before continuing. Do not silently carry a UX deviation forward.

### 4. Post handoff contract

Comment on issue #ISSUE_NUMBER:

```
## Phase N complete

### Built
- [from BUILT in report]

### For AI PR reviewers
**What changed:** [2-3 bullets]
**Key decision:** [1 sentence — the non-obvious choice and why]
**Out of scope (do not suggest):** [what was intentionally deferred]

### Handoff contract — Phase N+1 must respect these
**Exports:** `functionName(param: Type): ReturnType` — `path/to/file.ts`
**Firestore paths:** `/collection/{id}` schema: `{ field: type }`
**Routes/components:** `/route` — `ComponentName.svelte`
**Invariants:** [anything the next phase must not break]

### Settled (do not modify)
- [file or module now locked]
```

### 5. UX deviation comment (only if UX_DELTA is non-empty)

Post a SEPARATE comment:

```
## ⚠️ UX deviation — Phase N

**Spec said:** [quote from Intended Experience or User-testable outcome]
**What was built:** [from UX_DELTA]
**Impact:** [user-visible effect; whether future phases are affected]
**Recommended path:** [what to do — continue / adjust spec / fix in next phase]
```

Then PAUSE and wait for user input before continuing to phase N+1.
The user either confirms "continue" or redirects. Do not assume continuation.

### 6. Merge and commit

Merge the subagent's worktree branch into the issue branch created during Setup.

Commit message:
```
type(scope): short description (under 72 chars)

Phase N. [1-2 sentences on what this phase delivers and why.]

- [Key decision and why — the non-obvious part]
- [Another if needed]

Refs #ISSUE_NUMBER
```

Use `Refs #ISSUE_NUMBER` for every phase commit, including the last — the PR closes the issue, not the commits.
No `#N` anywhere except the footer. Nothing after the issue number.

If CI fails: spawn a claude subagent (worktree isolated) with the CI output and instruction to diagnose and fix. If the fix subagent cannot resolve it, stop and ask the user.

### 7. Continue or conclude

- More phases: immediately begin N+1 (back to step 1)
- Final phase done:
  1. Push the issue branch: `git push -u origin <type>/<slug>-ISSUE_NUMBER`
  2. Open a pull request (do NOT merge it):
     ```
     gh pr create --base main --head <type>/<slug>-ISSUE_NUMBER \
       --title "type(scope): short description" \
       --body "<see below>"
     ```
     PR body:
     ```
     Closes #ISSUE_NUMBER

     ## Summary
     [what was built across all phases — one bullet per phase]

     ## Phases
     - Phase 1: [outcome]
     - Phase N: [outcome]

     ## For reviewers
     [key decisions and anything intentionally out of scope]
     ```
  3. Post a summary comment on the issue listing what was built across all phases and linking the PR.
  4. Report done with the PR URL. Leave the PR open for the user to review and merge — never merge it yourself.

---

## Pause conditions (stop and wait for user)

- Validation fails (step 3): deliverables missing or must-not-touch violated
- UX deviation found (step 5): always pause before next phase
- CI failure the fix subagent cannot resolve
- Phase scope is ambiguous in a way that changes what gets built

In all other cases: make the call, note it in FLAGS or DECISIONS, continue.
