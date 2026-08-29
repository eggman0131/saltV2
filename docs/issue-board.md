# The issue board — "Salt — The Pass"

<https://github.com/orgs/eggmanorg/projects/1>

The board is where an issue's **priority, kind, size and pipeline position** live.
None of those are labels any more. This doc is the part that is not recoverable
from the board itself: what each value *means*, why the shape is what it is, and
what breaks if you change it.

Mechanics live beside the code — [`scripts/board.mjs`](../scripts/board.mjs) for
the API and the invariant check, [`board-status.yml`](../.github/workflows/board-status.yml)
for which transitions are automated.

---

## Why fields and not labels

Labels carried all of this until August 2026, and could not do the job. **A GitHub
Project can only group by and sort by a _field_.** A label is a single opaque
column: filterable, never groupable, never orderable. So "show me the recommended
queue in sequence" was unanswerable from the data as stored, and the board
degraded into one undifferentiated Triage column of 35 issues.

Nothing is kept in both places. `priority: critical|high|medium|low` and the
`status:` labels were **deleted**; `bug`, `feature`, `enhancement`, `refactor`,
`tech-debt` and `size: S|M|L` still exist but nothing applies them — they were
left in place because deleting a label strips it retroactively from every issue
that ever carried it, and ~280 closed issues would have lost their classification
for no gain.

**`status: on-hold` is the one survivor of its family**, because `/campaign` puts
it on parked **pull requests**, and a PR is never on the board.

Every `area: *` label and every topical label (`flaky-test`, `performance`,
`security`, `architecture`, `canon`, `domain`, `ci`, …) stays. They are
multi-valued and filter-only, which is exactly what a label is good at.

---

## `Queue` — which pile

| | |
| --- | --- |
| **Recommended** | Actionable **and proven**: regular user impact, a security risk, or dev friction actually being felt — regular test flake, merge-queue problems, CI/CD problems. |
| **Medium** | Real work, ordered by impact. |
| **Low** | Theoretical, never triggered, or drift that has not bitten. Safe to ignore; fold into a related issue, or pick up when bored. |
| **Deferred** | Parked, with the reason in `Blocked by`. |

**"Proven" is the whole discriminator.** A defect that is real, confirmed and
alarming but that has never once occurred is `Low`, not `Recommended` — #1056 is
the worked example: the schema bug is genuine, and `mealPlanTemplate` does not
exist in any environment, so its exposure is measured at zero.

### The promotion rule

> If a `Recommended` issue has an in-repo blocker, that blocker is itself
> `Recommended`, and sequenced above it.

Otherwise the top of the queue contains something that cannot be started, which
is the one thing the band is for. This is an invariant, so per CLAUDE.md rule 12
it is mechanical rather than remembered — `node scripts/board.mjs check` goes red
when a Recommended item's blocker is absent from Recommended or ordered below it.
It also fails on any closed issue still sitting on the board.

---

## `Class` — what kind of thing

`Defect` · `Refactor` · `New feature` · `Feature update` · `Infra`

`New feature` is something Salt cannot do at all today (freezer inventory);
`Feature update` is something it already does, done better (a better recipe view,
a better prompt). The split exists so the **Product** view can show product work
without twenty refactors in the way.

---

## Sequence is position, not a number

There is no rank field, and adding one would be a step backwards. Triage *is*
placement: you pick the band and the slot against the neighbours you can already
see, in one gesture. A view grouped by `Queue` with **no sort** gives that as a
drag; `updateProjectV2ItemPosition(projectId, itemId, afterId)` gives the
identical result to an agent, so a human and a script triage through one
mechanism and there is no number for either to keep current.

Two consequences, both load-bearing:

- **No view may carry a sort.** A sort disables dragging in that view and hides
  the order this writes. If a view ever needs sorting, it needs a different
  answer, not a `Rank` field.
- **The order is project-wide**, shared by every unsorted view. Harmless, because
  an issue is in exactly one `Queue` and grouping only slices that one order —
  but do the sequencing in **The queue** and treat **Product** as read-mostly,
  since a drag there moves the same global order.

---

## `Blocked by` — leads with the reference

Non-empty **is** what "blocked" means; there is no `Blocked` status. Format:

```
#952 — needs the prep-time decision settled first     ← in-repo, parseable
upstream: @genkit-ai/core@1.39.0 pins zod ^3.23.8     ← out of our hands
```

The leading `#N` is what `board.mjs check` parses, so the format is not
cosmetic — prose-first text makes the promotion rule unenforceable.

It holds the reason a `Deferred` item is parked, too. What it must **not** hold
is a status note on a working issue: #410 carried "PARTIAL. Step 1 shipped…" on
the old board, which would now mark a perfectly actionable issue as blocked.
That kind of note belongs in a comment on the issue.

---

## `Status` — the pipeline, and nothing else

```
Triage → Todo → In progress → In review → Merged → Released
```

*In review* is a PR raised, *Merged* is on `main` and not yet live, *Released* is
in production. **Blocked and Deferred are deliberately not statuses** — an issue
can be in progress *and* blocked, and the old board could not say so.

| To | Set by | |
| --- | --- | --- |
| Triage | GitHub's built-in "item added to project" project workflow | |
| Todo | a person, or `/triage` | the one real decision; no event can observe it |
| In progress | `/run`, when the branch is cut | a branch push is too noisy to key on |
| In review | `board-status.yml` | `pull_request` opened / ready_for_review |
| Merged | `board-status.yml` | `pull_request` closed && merged |
| Released | `board-status.yml` | production deploy succeeded **and** the merge commit is an ancestor of the deployed sha |

The issue↔PR link is the `Closes #N` that `/run` writes into every PR body —
the same text GitHub derives its own linked-issue relation from.

**`Released` is not "everything Merged".** Production deploys a *tag*, and
`Merged` only means "on `main`". Between a release tag being cut and its
approval-gated deploy finishing, more can land on main; marking those live would
be a lie the board tells about production. Hence the per-issue ancestry test, and
hence `fetch-depth: 0` on that job.

---

## The views

| View | Layout | Filter | Group by |
| --- | --- | --- | --- |
| The queue | table | `is:open -queue:Deferred` | Queue |
| Deferred | table | `queue:Deferred` | Class |
| Product | table | `is:open class:"New feature","Feature update"` | Class |
| Workflow | board | `is:open` | Status |

**Group by cannot be set through the API.** `ProjectV2ViewConfigurationInput`
exposes only `visibleFieldIds`; the group and sort keys are not in the public
schema, so a rebuilt view needs those two dropdowns setting by hand. Name,
layout, filter and columns are all scriptable.

---

## External setup

- **`PROJECT_TOKEN`** — a repo secret holding a fine-grained PAT with read/write
  on the org's projects and read on issues. The Actions `GITHUB_TOKEN` cannot
  write Projects v2 at any permission level, so `board-status.yml` and the
  board-add step in `pr-doc-review.yml` both need this. Locally, the `gh` CLI's
  own login needs the `project` scope.
- **The board must stay org-owned.** GitHub only links a project to a repository
  under the *same* owner, and `eggmanorg/salt` is org-owned. A user-owned project
  can hold the issues but can never appear on the repo, which is what the old
  "Saltv2" board did.
- **Adding an epic pulls in its sub-issues**, closed ones included — adding #778
  silently brought five closed children onto the board. `board.mjs check` fails
  on any closed item, so this surfaces rather than rots.
- **User project 6, "Saltv2", is the historical record** — 435 items, 293 of them
  merged PRs. Nothing writes to it; it is kept, not maintained.
