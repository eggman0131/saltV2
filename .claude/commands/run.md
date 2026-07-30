# Run Issue

Argument: $ARGUMENTS → ISSUE_NUMBER

You own two things end to end: the **spec contract** (the issue's phases are the scope — nothing more, nothing less) and the **git history** (branch, commits, PR). Everything else is yours to delegate or do directly as the work warrants.

Delegate breadth — codebase sweeps, independent implementation work, CI-log triage — and keep judgment: validation against the real diff, the git operations, and every decision the issue's audit trail depends on. Search and mechanical fan-out can run on a cheaper model; implementation and validation should not.

GitHub through the `gh` CLI throughout (`gh issue view`, `gh issue comment`, `gh pr create`). There is no GitHub MCP server in this repo.

## Standing rules

- **CLAUDE.md is binding.** Layer map, hard rules, data-model and Zod conventions, dependency pinning. A phase that can only be delivered by breaking one of them is a pause condition, not a judgment call.
- **No bodges.** If the phase as specified can only be built by contorting the code, stop and raise the spec question. The cleanest, most maintainable code wins over a delivered phase.
- **Flag the simpler path.** If a rule change or a different shape would be materially *simpler and more maintainable* (not merely easier or lazier), say so — in `DECISIONS` if you proceeded, as a pause if it changes the design.
- Everything else: make the call, record it, continue.

---

## Setup (once)

`gh issue view ISSUE_NUMBER --comments`. Read it in full and hold:
- **Intended Experience** verbatim — the UX baseline you validate every phase against
- the phase list: names, scopes, must-not-touch lists, user-testable outcomes, and which phase is last

A phase may carry more than one user-testable outcome; all of them are in scope for that phase and all of them get validated. Do not split a phase into extra loop iterations of your own, and do not collapse two.

Your held copy is authoritative. Don't re-read the issue mid-run and drift.

### Working branch

```
git checkout -b <type>/<slug>-ISSUE_NUMBER
```

- `<type>`: `feat`, `fix`, `chore`, `docs`, or `perf` per the change's nature.
- `<slug>`: ≤4 kebab-case words from the issue title. Issue #261 "Add meal-planner drag reorder" → `feat/meal-planner-drag-reorder-261`.

If the current branch is already dedicated to this issue (it ends in `-ISSUE_NUMBER`), reuse it rather than nesting. Never run phases on `main`.

All phase commits land on this branch; hold its name for the PR.

---

## Per-phase loop (N = 1 to final)

### 1. Context

Get whatever you actually need to implement Phase N well: CLAUDE.md, the docs its **Docs map** routes you to, and the files the phase's deliverables name. Delegate to Explore when the surface is wide or unknown; read directly when it's a known module. Skip this entirely for a phase whose ground you already covered in phase N-1.

When you delegate it, the report is restricted to exactly these three, and nothing else:

> 1. **Layers in play** — which packages the phase touches, and any layer-map boundary it crosses.
> 2. **Binding constraints** — the CLAUDE.md rules and doc contracts that bound *this* phase, each named (rule number, `docs/…` section) rather than paraphrased.
> 3. **What to reuse or respect** — existing functions, types, patterns and tests already covering this ground, with `file:line`.
>
> No preamble, no restating the phase scope, no walkthrough of how the existing code works, no implementation proposal. If one of the three has nothing to report, say so in a line and move on.

### 2. Implementation

**Default: implement in-place on the issue branch** — either directly or via a subagent without worktree isolation. Phases are a dependent chain, and `isolation: "worktree"` branches from `main`, not from `HEAD`: a worktree subagent would not see the previous phases' work.

Use `isolation: "worktree"` only for genuinely independent work you want to run in parallel, and land it with `git cherry-pick` (not merge) onto the issue branch — a worktree branch's merge base is `main`, so merging drags the whole diff-from-main with it. Never run two in-place subagents concurrently; they share one checkout and one `HEAD`.

Brief the implementer with **only** what the phase needs:
- Phase N spec — scope, technical deliverables, must-not-touch — not the whole issue
- the context from step 1
- the previous phase's handoff contract (omit for phase 1)

And instruct it:

> Implement exactly what is in scope. Do not read or implement any other phase.
> Make technical decisions autonomously — CLAUDE.md is your guide, and it is binding.
> If the scope can only be delivered by bending a rule in CLAUDE.md or contorting the code, stop and report that instead of doing it.
> Do not commit and do not post GitHub comments.
> Return:
>   BUILT: [what was implemented]
>   DECISIONS: [any choice not specified in scope, and why]
>   UX_DELTA: [anything differing from the phase's user-testable outcome(s) — or NONE]
>   FLAGS: [anything the next phase must know that isn't in the scope — or NONE]
>   CONCERNS: [any rule the scope pushed against, or a simpler/more maintainable shape you'd recommend — or NONE]

### 3. Validate

Check the work, not just the report — a self-report is a claim, `git diff` is evidence.

- `git status --short` and `git diff --stat`: does the changed-file set match "Technical deliverables", and does it stay clear of "Must not touch"? Read the diff wherever the answer isn't obvious from the paths.
- Run the mechanical gates that the changed files actually implicate: `pnpm lint`, `pnpm typecheck`, `pnpm check` (Svelte templates), `pnpm test`, and `pnpm depcruise` for anything touching the import graph. Fix or delegate fixes until they're green — do not commit red.
- `UX_DELTA` against the phase's user-testable outcome(s), and `CONCERNS` against the standing rules.

Deliverables missing, or must-not-touch violated → do not commit. Comment on the issue describing the gap, stop, wait for me.
`UX_DELTA` non-empty → step 4 next, and pause there before committing anything.
`CONCERNS` naming a rule collision or a materially better shape → surface it to me before committing.

### 4. UX deviation (skip unless `UX_DELTA` is non-empty)

A comment of its own:

```
## ⚠️ UX deviation — Phase N

**Spec said:** [quote from Intended Experience or the user-testable outcome(s)]
**What was built:** [from UX_DELTA]
**Impact:** [user-visible effect; whether future phases are affected]
**Recommended path:** [continue / adjust spec / fix in next phase]
```

Then pause for me. I either confirm "continue" or redirect — never assume continuation. On "continue", carry on to step 5; on a redirect, rework and re-validate from step 3.

### 5. Commit

```
type(scope): short description (under 72 chars)

Phase N. [1-2 sentences on what this phase delivers and why.]

- [Key decision and why — the non-obvious part]
- [Another if needed]

Refs #ISSUE_NUMBER
```

`Refs #ISSUE_NUMBER` on every phase commit including the last — the PR closes the issue, not the commits. No `#N` anywhere but that footer, and nothing after it.

### 6. Handoff comment

Comment on issue #ISSUE_NUMBER. This is the audit trail and the brief for the AI PR reviewers — keep every heading, drop any line that would be filler:

```
## Phase N complete

### Built
- [from BUILT]

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

### 7. Continue or conclude

More phases → straight into N+1 at step 1.

Final phase done:
1. `git push -u origin <type>/<slug>-ISSUE_NUMBER`
2. Open the PR — do **not** merge it:
   ```
   gh pr create --base main --head <type>/<slug>-ISSUE_NUMBER \
     --title "type(scope): short description" \
     --body "<see below>"
   ```
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
   If this PR is one of several for the issue, append ` (#ISSUE_NUMBER)` to the title and use `Refs` instead of `Closes`.
3. Watch CI (`gh pr checks --watch`). Red → get the failing log, diagnose and fix on the issue branch (delegate the triage if the log is large), commit, push. Can't resolve it → stop and tell me.
4. Comment on the issue summarising all phases and linking the PR.
5. Report done with the PR URL. Leave the PR open for me to review and merge — never merge it yourself.

---

## Pause conditions (stop and wait for me)

- Deliverables missing or must-not-touch violated (step 3)
- A UX deviation (step 4) — always, before the commit and the next phase
- The phase can only be built by breaking a CLAUDE.md rule, or only by a bodge
- Phase scope is ambiguous in a way that changes what gets built
- CI failure you can't resolve

Otherwise: make the call, record it in `DECISIONS`/`FLAGS` or the handoff comment, continue.
