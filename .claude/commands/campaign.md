---
description: Coordinate several issues end to end — run /run per issue in its own worktree from a rolling pool, adversarially review each PR, then land them through a serial merge queue. Owns branch topology and merging; writes no code.
argument-hint: <issue numbers>
disable-model-invocation: true
---

# Campaign

Arguments: $ARGUMENTS → issue numbers (space- or comma-separated), plus optional flags anywhere in the string:

| Flag | Default | Meaning |
| --- | --- | --- |
| `--pool N` | 2 | Concurrent workers. See **Pool** below before raising it. |
| `--max-diff N` | 1500 | Changed-line ceiling per PR, enforced by the worker. |
| `--stop-at-green` | off | Review and leave PRs green; do not run the merge queue. |

`/campaign 641 652 703 --pool 3` is the shape. Unrecognised flags are an error, not a guess — say which and stop.

No issue numbers given? Ask which issues and stop. This is the only pre-flight stop worth making; everything after it runs unattended.

You are a coordinator. You own three things and nothing else: the **schedule** (which issues run when, and why), the **merge queue** (what lands, in what order, against what base), and the **ledger** (the tracking issue that lets a fresh session resume this campaign). Implementation belongs to /run. Review belongs to a reviewer agent. Diff-reading, conflict resolution, log-triage and codebase sweeps belong to subagents.

The success condition is a clean tree when Daniel comes back: every issue merged to main, or parked with a named reason and a discoverable branch. Never five branches needing a rebase. That is the failure this command exists to prevent, and the serial merge queue is how it is prevented.

## Standing rules

- **Context hygiene is a hard rule, not an aspiration.** You do not read source files, diffs, CI logs, or test output. If you are about to Read something under `packages/`, `apps/`, or `docs/`, that is a delegation. You read: issue bodies, issue and PR comments, structured agent returns, and `gh`/`git` status output. File names are not diffs — `git diff --name-only`, `gh pr view --json files` and `git status` are yours and you will need them. A coordinator that reads diffs runs out of context at issue three and restarts work that already landed.
- **Unattended by default.** Daniel is not watching. AskUserQuestion is unavailable to you in spirit even where it exists — a question blocks the fleet for hours. Decide inside the envelope below; outside it, park the branch and keep the queue moving.
- **CLAUDE.md is binding**, for you and every agent you spawn.
- **The git guard is real.** `scripts/git-guard.mjs` refuses `git push …main`, `git push --no-verify`, and bare `git stash` / `stash pop` / `stash clear` — the stash stack is shared across every worktree and concurrent agent. Land things with `gh pr merge`. Set work aside with a WIP commit, never a stash.
- **/run is the worker.** Do not reimplement the phase loop. Point each worker at `.claude/commands/run.md` and give it the overrides in **Dispatch**. Two copies of that loop will drift within a month.
- **GitHub through the `gh` CLI throughout.** There is no GitHub MCP server in this repo. Two harness traps, and every brief you write carries both: plain `gh issue view` / `gh pr view` exit 0 with **empty stdout** in a non-TTY session — use the `--json` forms or `gh api`, and treat empty comment output as a failed fetch, never as "no comments" — and every `gh` call needs the sandbox disabled.

---

## Setup

### 1. Resume, don't restart

Before anything: `gh issue list --search 'in:title "campaign:"' --state open`. If an open campaign issue covers this set, it is your state — read its body (the status table, below), not its comments. Announce where you're resuming. Re-dispatching a merged issue is the worst outcome available in this command.

Cross-check the table against reality before trusting it. Match on the branch names you control, not on full-text search — per branch, so no listing limit can truncate what you see:

```
gh pr list --head <branch> --state all --json number,state,mergedAt   # one call per table row
git worktree list
```

Any row whose recorded state disagrees with what `gh` says — "merged" with an open PR behind it, "in progress" with no branch — means something broke mid-queue. Park that issue, correct the row, say so. Never build on a row you could not confirm.

Workers do not survive a session: a `dispatched` row from a dead session has no live agent behind it. Verify what its branch actually holds (the per-branch PR check above, plus `git log --oneline origin/main..origin/<branch>` if it was pushed), then either re-dispatch from where it stands — /run's own resume logic picks up landed phases — or park it.

### 2. Read the issues, derive the footprints

`gh issue view N --json title,body,labels` for each. From each issue hold only:

- title, kind (`/spec` / `/defect` / `/refactor-spec`), phase count;
- the union of every phase's **Technical deliverables** and **Must not touch** paths — this is the issue's **footprint**;
- any explicit dependency the body states ("depends on #N", "after #N", "supersedes #N").

You do not need the phase detail. /run reads the issue itself; re-holding it here just burns the context you are trying to protect.

If an issue has no phase blocks, or its phase blocks carry no Technical deliverables, it is not /run-able. Park it before the campaign starts and say which.

### 3. Conflict graph, not waves

Two issues are **in conflict** when either holds:

- one names the other as a dependency;
- their footprints share a file, or share a **module directory** — the deepest named directory under a package's `src/` (`packages/domain/src/recipe/**` overlapping `packages/domain/src/recipe/queries/**` counts; two issues that merely both touch somewhere in `packages/domain` do not).

Footprint overlap serialises, even when the issues are logically independent. Overlap discovered at merge time costs a rebase, a re-review and a re-run of CI; overlap predicted here costs nothing but ordering. Be generous about what counts — the asymmetry is that lopsided.

Two files are excluded from footprint overlap, because otherwise they collide on almost every campaign and neither collision is real:

- `pnpm-lock.yaml` — any two issues adding a dependency touch it. At merge time, resolve by regenerating (`pnpm install --lockfile-only`), never by park.
- the **Docs map table in CLAUDE.md** — any two issues adding a doc row touch it. Resolve by re-applying both rows.

Both are delegated resolutions like any other; they are simply never a reason to stop.

Order the issues into a list: dependencies before dependents, and where neither depends on the other, cheapest (fewest phases) first — a short issue that merges early frees its footprint for everything behind it.

### 4. Rolling pool, not a barrier

Run a pool of `--pool` concurrent workers, default 2.

Two is the default because the constraint is the host, not the plan: each worktree needs its own `pnpm install`, and every worker runs `pnpm test` and `pnpm check` on the same laptop. Past the point where those saturate CPU or disk, a further worker makes all of them slower rather than the set faster — and slower workers hit their time budgets, which turns a throughput problem into parked branches.

Raise it when the host genuinely has the headroom (more cores, and Daniel not working in the main checkout at the same time). If `--pool` is above 4, say once in the ledger that you're running wide and why it was asked for — then do it. The flag is Daniel's call to make, not yours to second-guess.

When a worker returns, start the next issue in the list all of whose conflicts have reached a terminal state — merged, or parked. Do not wait for a batch to finish before starting the next: a fixed wave where one issue takes three times as long as the other leaves half your capacity idle for the difference. A dependent issue's worker cuts from `origin/main` after its dependency has merged, which is why there is no integration branch — dependency ordering falls out of the merge queue for free.

If no issue is currently startable (everything left is blocked behind something in flight), run the pool below capacity. That is correct, not a stall.

### 5. Open the ledger, then go

```
gh issue create --title "campaign: <slug> (#a #b #c)" --body "<the plan below>"
```

No label — the `campaign:` title prefix is the discoverable marker, and it is what the resume search matches. The body is the live state of the campaign and it is what a fresh session reads. Keep it current with `gh issue edit <ledger> --body-file <file>` on every transition:

```
## Plan
Order: #a → #b → #c
Pool: 2   Max diff: 1500   Ending: merge to main
Conflicts: #b after #a (shared packages/domain/src/recipe/**)
Envelope: <the decision envelope you are operating under>

## Status
| Issue | Branch | PR | State | Worker | Note |
|---|---|---|---|---|---|
| #a | feat/slug-a | #101 | merged | — | |
| #b | feat/slug-b | #102 | in review | — | round 1: 1 blocking |
| #c | fix/slug-c | — | dispatched | agent <id>, watchdog <shell-id>, 09:14 | budget to 12:14 |
| #d | — | — | queued | — | after #b |
```

States: `queued → dispatched → PR open → in review → merge queue → merged | parked`.

Comments on the ledger remain the audit trail — one per transition, with the reasoning that doesn't fit in a table cell. But state lives in the body, so resume is one read of one field rather than a parse of thirty comments in indeterminate order.

Then start. Do not wait for confirmation — the point of posting the plan is that Daniel can interrupt, not that you stop.

---

## Worktrees

```
git fetch --no-tags origin main
git worktree add -b <type>/<slug>-N .claude/worktrees/<slug>-N origin/main
```

**The fetch is not optional, and it goes immediately before every `worktree add`.** `origin/main` here is the local remote-tracking ref — whatever the last fetch saw. The rolling pool creates worktrees over hours, and a dependent issue's whole premise is that it cuts from a main that already contains its merged dependency; skip the fetch and it builds against a base from before the merge.

Explicitly, with `git worktree add` — **not** the Agent tool's `isolation: "worktree"`. That flag branches from main with no way to choose a base and no way for you to name the branch, and /run needs to own a branch it can push and PR.

`.husky/post-checkout` fires `ensure-checkout.mjs` on `worktree add`, which installs dependencies, writes the gitignored dev env files, and — the invisible one — restores `core.hooksPath` so the pre-commit gates actually run. A worktree created any other way has dead commit hooks.

- **One worker per worktree.** Never two agents in one checkout; they share a HEAD.
- **Workers run the safe gate set only.** `lint`, `typecheck`, `check`, `test`, `depcruise`, `boundary:test`, `format:check`, `docsmap:check`, `theme:check`, `provenance:check`. The guarded commands — `dev`, `dev:emulators`, `test:emulator`, `e2e*` — seize host-global singletons and `scripts/host-guard.mjs` refuses them in a linked worktree. That refusal is correct. Never set `SALT_TAKE_HOST=1` to get past it: from a worktree it kills whatever Daniel is sitting in. The heavy suites are CI's job, at merge time.
- **On merge:** remove the worktree and delete the local branch (see the queue for the ordering — it matters).
- **On park:** the branch must survive and be findable. Push it (`git push -u origin <branch>` — a WIP commit first if the tree is dirty), label the PR `status: on-hold` (the repo's parked label — do not invent a new one), comment the reason on the PR as well as the ledger, then remove the worktree. A parked issue whose state exists only in a ledger comment is a parked issue nobody finds.
- Finish the campaign with `git worktree prune`. This repo currently carries four stale prunable worktrees and an orphaned `integration/current-sprint` branch from an earlier attempt; do not add to them.

---

## Dispatch

**Workers are Agent-tool subagents, spawned in the background — one per worktree.** This choice is load-bearing, so do not substitute a mechanism: a subagent has a task id the harness can kill (`TaskStop`) and *confirm* killed, it cannot outlive your session — so a resumed campaign never inherits a live worker it cannot see — and it runs unattended without any permission-flag guesswork. Record the agent's id in the ledger row **at the moment you dispatch it**, before anything else. A handle you did not record at dispatch cannot be recovered afterwards, and you will not read logs to find it.

**Arm a watchdog with every dispatch.** Every worker carries a budget — state it in the brief (default: no single phase longer than 45 minutes, no worker longer than 3 hours) — but a budget nobody checks is dead text: a spinning worker does not return BLOCKED, it returns nothing, and nothing wakes you for a worker that has hung. So alongside each worker, start a backgrounded shell that is nothing but `sleep <budget-seconds>` (Bash, `run_in_background: true`), named for the issue. Its exit re-invokes you; record its shell id in the same ledger row. Worker returns on time → `TaskStop` its watchdog as part of processing the return. Watchdog fires first → the budget is breached.

Brief each worker with:

> Follow `.claude/commands/run.md` verbatim for issue #N, with these overrides:
>
> - You are already in worktree `<path>` on branch `<branch>`, cut from `origin/main`. Skip run.md's **Working branch** step; do not create or switch branches.
> - Your base is `origin/main`. run.md's per-phase `git fetch origin main && git rebase origin/main` stands exactly as written.
> - Run the safe gate set only. Never `e2e`, `test:emulator`, `dev`, or `dev:emulators`, and never `SALT_TAKE_HOST=1`.
> - `gh` in this harness: plain `gh issue view` / `gh pr view` exit 0 with empty stdout — use the `--json` forms or `gh api` (issue comments: `gh api "repos/{owner}/{repo}/issues/N/comments"`), and every `gh` call needs the sandbox disabled. Empty output from a comments fetch is a failed fetch, not an empty thread.
> - Do run `gh pr ready` at the final phase, as run.md says. It is what triggers `pr-doc-review.yml`, and that review is an input to the code review that follows.
> - Do not merge, and do not touch any branch but your own.
> - Diff ceiling: <--max-diff> changed lines, excluding the lockfile. At the end of every phase, before the handoff comment, check the branch against its base: `git diff --shortstat origin/main...HEAD -- ':!pnpm-lock.yaml'`. Over the ceiling, stop there — commit, post the handoff for the phase you finished, and return `BLOCKED: oversized (<n> lines at phase <k> of <m>)` naming the phases still unbuilt. Leave the PR in draft; do not `gh pr ready`. A phase that cannot be built under the ceiling on its own is itself the finding: say so.
> - run.md's pause conditions are yours, with one change: you cannot wait for a human. On a pause condition, stop, commit what you have, leave the branch as it is, and return BLOCKED with the reason.
>
> Return, and nothing else:
> ```
> ISSUE: N
> BRANCH: <name>          PR: <number or NONE>
> PHASES_LANDED: <n of m>
> CI: <green | red | heavy-suites-skipped>
> DECISIONS: [choices not specified in the issue, and why]
> FLAGS: [anything another issue in this campaign must know]
> CONCERNS: [rules the scope pushed against, or a simpler shape you'd recommend — or NONE]
> BLOCKED: [pause condition hit, or NONE]
> ```

**On budget breach, terminate before recycling the slot.** In this order, and do not skip a step:

1. `TaskStop` the worker's agent id.
2. Confirm it actually stopped: the harness reports the task killed. An unconfirmed kill is a live worker.
3. Only now: park the branch as it stands (`BLOCKED: timeout`), and free the slot.

The slot is the smaller half of this. A worker you left running still holds a worktree, still runs `pnpm test` against the resources the next worker needs, and — the one that actually costs you — can still commit and push to a branch you have parked, or push under the merge queue mid-rebase. That produces a `--force-with-lease` failure or a merged branch containing work nobody reviewed. Never start a replacement worker into a slot whose previous occupant you have not confirmed dead. If the kill cannot be confirmed, do not recycle the slot at all: run the pool one narrower for the rest of the campaign and log it.

**BLOCKED non-empty** → park the issue, log it, start the next startable issue. Do not diagnose it yourself; that is diff-reading.

**`BLOCKED: oversized`** is the one blocked reason that gets an action rather than a bare park: file a follow-up issue proposing the split (the phases that landed, the phases that didn't, and the ceiling it hit), reference it from the parked branch, and move on. The branch stays parked either way — you do not decide the split yourself, because how an issue divides is a spec question and /spec is where it belongs.

**FLAGS naming another campaign issue** → record it in the ledger and re-check the conflict graph. A flag is the one signal that can reveal an overlap the footprints did not.

---

## Review

A PR is review-eligible only after you have verified what the review prompt asserts. The worker's `CI` field says green — check it agrees with reality now: `gh pr checks <pr>` (the heavy suites may show as passed-because-skipped if a sibling merged since the worker finished; that is the merge queue's problem, re-run after its rebase — what must be genuinely green here is everything else). A red check means the worker's return was wrong, and a worker that misreported CI may have misreported anything: park, don't review.

One reviewer agent per PR, spawned fresh, **read-only** — it must not have the branch checked out and must not fix anything. A reviewer that can fix things will, and you lose the signal.

Give it: the issue body (`gh issue view N --json title,body`); the per-phase handoff comments — `gh api "repos/{owner}/{repo}/issues/N/comments"`; the existing PR discussion — `gh api "repos/{owner}/{repo}/issues/<pr>/comments"` **and** `gh api "repos/{owner}/{repo}/pulls/<pr>/reviews"` (`pr-doc-review.yml` has already run by this point, and so may other AI reviewers; conversation comments and review bodies live on different endpoints, so fetch both); and `gh pr diff <pr>`. The plain `--comments` forms print nothing in this harness — never conclude "no comments" from their output.

A PR reaching review is already under the ceiling — the worker enforced `--max-diff` at every phase boundary, so an oversized branch parked with its PR still in draft. That is deliberate: splitting a large diff across two reviewers splits the review too, and neither half can see a duplication or an architectural drift that spans the boundary. The fix for a diff too large to review is a PR that should have been two PRs, and the only place to fix that is upstream, in the phase loop.

So: confirm, don't split. `gh pr view <pr> --json additions,deletions,changedFiles` — counts, not content, and remember the worker's count excluded `pnpm-lock.yaml`: an overage the lockfile explains (check `--json files`) is not a breach. Genuinely over the ceiling means the worker's check did not run, which means you do not know what else it skipped: park the branch and file the split follow-up, exactly as for `BLOCKED: oversized`. Do not review it anyway.

> Review PR #X against issue #N adversarially. Assume it is wrong and find where.
>
> Do not re-litigate what the gates already prove. `lint` + `depcruise` + `boundary:test` prove the import graph and the layer map. `typecheck` + `check` prove the types. `docsmap:check` proves the Docs map has a row. `theme:check` and `provenance:check` prove the tokens. All green on this PR — verified before you were spawned. Re-reporting any of them is noise.
>
> Do not repeat findings already on the PR. Read the existing comments first.
>
> Scope is the issue's phases. The handoff comments carry **Out of scope (do not suggest)** — that list is binding. Suggesting work the issue deliberately deferred is a defect in the review, not a finding.
>
> Look at the four things the gates structurally cannot see:
> 1. **Testing** — do the assertions test behaviour, or merely execute the code? What case is missing? Judge against the reviewer checklists in `docs/unit-test-spec.md` (UT-*) and, for e2e, `docs/e2e-test-spec.md`. If a checklist file is absent on this branch, say so and judge on the merits — do not improvise a checklist and attribute it to the doc.
> 2. **Documentation** — does a doc in CLAUDE.md's Docs map now say something false? A row existing is not a doc being true.
> 3. **Duplication** — semantic, not textual: the same rule expressed in two places that can now disagree.
> 4. **Architectural intent** — legal by depcruise but wrong in spirit: policy leaking into an adapter, a domain concern implemented in a component.
>
> Severity, and be strict about the top one:
> - **blocking** — you can state a concrete failure: this input, this state, this wrong output or crash. If you cannot name one, it is not blocking.
> - **should-fix** — real, but ships safely and can be a follow-up.
> - **note** — style, taste, preference.
>
> Post one review: `gh pr review <pr> --comment --body-file <file>` (every `gh` call needs the sandbox disabled), findings grouped by severity, most severe first. Then return only the counts and the blocking findings' one-line summaries.

### Fixing findings

Do not re-dispatch /run for this. run.md is a phase loop keyed to an issue whose phases have all landed; pointed at a finished branch it either no-ops or restarts work. Spawn a plain agent instead:

> In worktree `<path>` on branch `<branch>`, address these blocking review findings: [list]. Do not rebase, do not merge, do not touch another branch, and do not take work beyond the findings — the issue's Out of scope list still binds. Run the safe gate set, commit, push.
>
> Return:
> ```
> FIXED: [finding → what changed]
> REJECTED: [finding → why it is wrong, or why the fix is worse than the bug]
> GATES: <green | red>
> ```

Rounds are capped at two. Round 1 is the full review. Round 2 may only verify the blocking items from round 1 — no new findings, unless the fix introduced a new blocking regression. There is no round 3: anything still open after round 2 becomes a follow-up issue.

**You adjudicate, not the reviewer.** A rejection is a position, not a veto; you decide, record the decision in the ledger, and move on. Reviewer-wins is a deadlock and this command runs unattended.

Every should-fix and every rejected-but-real finding becomes a follow-up issue (`gh issue create`, referencing the PR) before the branch merges. Notes are dropped. Do not let the reviewer's taste hold the queue.

---

## Merge queue

**Strictly serial.** One branch at a time, start to finish. This is the part that makes the end state clean, and the ordering is the mechanism — parallelising it recreates exactly the pile of stale branches this command exists to avoid.

The queue being serial does not idle the pool: while a branch is in the queue, workers on other issues keep running and the pool keeps refilling. What is serialised is landing, not working.

`--stop-at-green` skips this section entirely. Reviewed, green, unmerged PRs are the deliverable; go straight to **Finish** and report them. Leave the worktrees in place — Daniel will want them if he's landing these by hand.

A branch is queue-eligible when: PR out of draft, review closed with no blocking findings outstanding, follow-up issues filed.

For each eligible branch, in list order:

1. `git fetch --no-tags origin main`
2. **Rebase in its worktree — delegated.** Spawn an agent: rebase onto `origin/main`; on conflict, report the conflicted paths and stop without resolving. You then classify from the paths alone against the footprints of what this campaign has already merged (this is why you hold footprints, and why file names are not diffs):
   - conflicted paths all inside a merged sibling's footprint, or `pnpm-lock.yaml`, or the Docs map → this campaign's own work; resolve it. Send the agent back with the classification and the resolution rule; it resolves, runs the safe gate set, continues the rebase.
   - any conflicted path outside → **park**. Someone else's concurrent change is not yours to resolve. Abort the rebase (`git rebase --abort`) so the worktree is left clean for a human.
3. **Re-run the safe gate set.** This is the semantic-conflict catch, and the single highest-value step in the queue: two branches can each be green alone and red together, with no textual conflict between them. Red → park, log, next.
4. `git push --force-with-lease`
5. Wait for CI: `sleep 20 && gh pr checks <pr> --watch --fail-fast`. Blocking is fine here — the pool is what keeps working.
6. **Confirm the heavy suites actually ran.** A skipped required check reports as passing, and `ci.yml` skips both heavy suites when a branch is behind `origin/main` — which every unrebased sibling is. Read the job conclusions, never the check summary. (This recipe is run.md step 8's, held in lockstep deliberately — if the job names in `ci.yml` move, both files change together.)
   ```
   gh run list --branch <branch> --limit 1 --json databaseId --jq '.[0].databaseId'
   gh run view <id> --json jobs --jq '.jobs[] | select(.name | test("E2E|integration")) | "\(.name): \(.conclusion)"'
   ```
   - `success` → land it.
   - `skipped`, and the PR's changed files are only docs/CI/meta paths → legitimate skip: say so in the ledger and land it.
   - `skipped` otherwise → the rebase did not take; go back to step 1.
   - **empty output → park.** No matching jobs means the job names in `ci.yml` have moved and this check is now blind. Cannot-confirm is never green, and a silently-passing regex is exactly how a broken heavy suite lands.
7. **Remove the worktree and delete the local branch — before the merge.** Git refuses to delete a branch that is checked out in a worktree, so `--delete-branch` fails its local half if the worktree still exists. Cleanup first; the branch is pushed, so nothing is lost, and if the merge somehow fails the worktree can be re-added from the remote.
8. `gh pr merge <pr> --squash --delete-branch`
   Squash, because main is linear and squash-merged — subjects end `(#PR)`. The per-phase history lives in the issue's handoff comments, which is where run.md put it; git does not need a second copy.
9. Update the ledger row. Next branch.

Each merge to main triggers `deploy-staging.yml` off CI completion. That is expected and it is what staging is for — but it means a campaign lands N staging deploys, so do not queue a merge you would not want deployed.

---

## Decision envelope

Running unattended means most of run.md's pause conditions become deadlocks. Resolve these yourself, record them, continue:

- a review finding's severity, and whether a rejection is reasonable;
- a rebase conflict classified as this campaign's own work;
- a flaky CI job — re-run once, then treat a second failure as real;
- ordering among issues that don't conflict;
- whether a FLAG changes the conflict graph.

**Park the branch — not the campaign — for these:**

- a worker returns BLOCKED, or blows its budget (the watchdog fired — terminate and confirm first; see **Dispatch**);
- a PR over the `--max-diff` ceiling, whether the worker caught it or you did;
- a UX deviation (run.md step 4) — always a human call, never yours;
- a CLAUDE.md rule collision, or a phase that can only be built as a bodge;
- a rebase conflict touching a path outside this campaign's merged footprints;
- gates red after a rebase (the semantic conflict);
- blocking findings still outstanding after round 2;
- heavy suites that will not run green, or cannot be confirmed to have run.

Parking never stops the queue.

**Stop the whole campaign** only for a systemic failure, meaning one of:

- main is red on its own — verify with `gh run list --branch main --limit 1` before believing it;
- two consecutive merges have gone bad, where bad means either the merge itself failed, or main's post-merge CI went red. Two in a row is not coincidence, and every further merge compounds it.

On a full stop: leave every branch pushed and every worktree intact, write the state into the ledger body, and say plainly what needs a human.

---

## Finish

When the queue is empty:

1. Final ledger comment, and set the body's table to its terminal state:
   ```
   ## Campaign complete
   **Landed:** #a (PR #1), #b (PR #2)
   **Parked:** #c — [reason, what a human needs to decide, branch name]
   **Follow-ups filed:** #d, #e
   **Decisions taken:** [one line each]
   ```
   Close the ledger issue only if nothing is parked. A parked issue is unfinished business and the open ledger is where it lives.
2. `TaskStop` any watchdog still running; `git worktree prune`; confirm no campaign worktrees remain, and that every remaining remote branch is one you deliberately parked (labelled `status: on-hold`, reason on the PR).
3. Report: landed, parked with reasons, follow-ups. One read, no digging. If everything landed, say so in a sentence and stop — a clean campaign does not need a report longer than its ledger.
