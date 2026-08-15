---
description: Design a feature and post it as a phased GitHub issue that /run can execute. An architecture read, the forks put in front of the user, then the issue — no code.
argument-hint: <what you want to build>
disable-model-invocation: true
---

# Feature Spec

I want to build: $ARGUMENTS

You are designing, not building. The deliverable is a GitHub issue. Do not write code.

## When to use this

This is the heavyweight path — an architecture read, Explore agents, a tracked issue carrying a decision
audit trail. It earns that weight when at least one is true:

- the feature crosses a layer, or you don't yet know which layers it lands in;
- there is a real architecture fork worth deciding before any code exists;
- CLAUDE.md's issue-first rule already demands an issue (new package, new dependency, layer-map edit,
  cross-package refactor);
- the work is genuinely large enough to want phases.

If it is a contained change to a module you can already name, with no fork for me to decide, **do not run
this** — build it and report. A one-line change does not need a four-phase issue, and producing one is a
cost rather than a courtesy. When unsure, say so and ask before spinning up the full flow.

## Standing rules

- **CLAUDE.md is binding.** If the feature can only be built by bending a rule in it, that is a finding to surface in Step 2 — not a detail to settle quietly during implementation.
- **No bodges.** If the clean design needs the spec to change, say so and get agreement before the issue is posted. Never contort the architecture to fit a draft spec.
- **Flag the simpler path.** If a different shape — or changing a repo rule — would be materially *simpler and more maintainable* (not merely easier or faster to write), raise it with the trade-off. Staying silent is a claim that the current shape is right.
- **GitHub through the `gh` CLI** (`gh issue list`, `gh issue create`, `gh label list`). There is no GitHub MCP server in this repo.

## Step 0 — Read back before spending anything

If `$ARGUMENTS` is empty, ask what I want built and stop here.

Otherwise, before any sweep: one paragraph on what you take the ask to be and roughly where in the repo
you expect it to land. Correcting you here is free; correcting you after a wide Explore means the read
was aimed at the wrong surface, and Step 2 is too late to find that out.

If the ask is already unambiguous and you can name the module, say so in that same paragraph and carry
straight on to Step 1 — the point is that I *can* interrupt, not that you stop and wait every time.

## Step 1 — Architecture read

Read what the feature actually touches. CLAUDE.md is already in your context — don't re-read it. Its **Docs map** is the routing table: open the docs whose *Tracks* globs match the code you expect to change, plus `docs/salt-architecture.md` for anything crossing a layer boundary.

Read the long docs at section granularity. `docs/design/ui-spec-v02.md` is ~1800 lines and `-v04` ~1270 — grep their headings and read the section your change lands in. Whole-file reads are for the short docs.

Delegate breadth to Explore subagents when the surface is wide or you don't yet know where the feature lands; read directly when it's one known module. One Explore over the whole surface beats three overlapping ones — you pay for the overlap twice, once in tokens and again reconciling three reports. Search fan-out can run on a cheaper model; the design judgment stays with you.

Check for prior art too: `gh issue list --search "<keywords>" --state all`. Extending or superseding an existing issue beats duplicating it.

Scope the read's output to four things and no others: **layers involved**, **binding constraints** (named — rule number, `docs/…` section — not paraphrased), **existing patterns to reuse**, and **anything that looks like it will fight the architecture**. No code walkthroughs, no implementation proposals — those come later, if at all.

**Keep the `file:line` as you go.** This read gets spent twice: once writing the issue, and once by `/run`, which otherwise re-derives exactly these things once per phase — five architecture sweeps for a four-phase feature. Pointers recorded now are sweeps `/run` never pays for again; the **Context pointers** field in each phase block is where they land.

## Step 2 — Clarify with user

Ask about intended UX and outcomes, and put the architecture forks in front of me *before* they get baked in. Use `AskUserQuestion` for real forks with discrete options; plain prose for open-ended UX questions. Do not propose implementation yet.

If a new dependency is in the picture, check what is actually published (`npm view <pkg> version`) before it reaches the issue — never a version from memory.

## Step 3 — Draft and post the issue

Once we've agreed, post it with `gh issue create`.

**Issue metadata:**
- Title: `feat: <concise feature name>` (imperative, no trailing period)
- Labels: `feature`, plus the area and priority labels that fit (`gh label list` for the current set — e.g. `area: web-pwa`, `domain`, `architecture` when the layer map moves, `breaking-change` when back-compat is at stake)

**Issue body — use exactly this structure.** `/run` consumes these headings; the phase blocks are its scope contract.

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
[One `### Phase` block per phase, numbered Phase 1 through Phase N.

Every phase must end user-testable — but that is a constraint on where a boundary may *fall*, not a
reason for one to exist. Phases are not free: each one costs a context read, a validation pass, a gate
run, a commit and a handoff contract, and that contract is a lossy hand-off of things the model would
otherwise simply hold in context. A phase may carry several user-testable outcomes when they form one
coherent unit of work.

Split only where there is a reason to:
- **an unresolved fork** — the increment rests on something in Open Questions the user should judge
  before more is built on it;
- **a learning dependency** — the next increment's design depends on what this one reveals in practice;
- **a point of no return** — after this, backing out gets expensive; or
- **too large to validate as one diff** — the reviewer (human or AI) can't reliably judge it in one pass.

None of those apply? Keep it together. A settled design with no open questions is often 1–2 phases;
an exploratory one with live forks earns more.]

### Phase 1: [Name]
**Scope:** [What gets built — precise, not vague]
**User-testable outcome(s):** [What the user can observe when this phase is done — one line each if several]
**Technical deliverables:** [Files, routes, Firestore paths, exported functions/types]
**Context pointers:** [What Step 1 already learned about *this* phase, so `/run` reads rather than re-sweeps:
`file:line` for the code to reuse or respect, and the named rules and `docs/…` sections that bound it.
Written for an agent arriving with no context — thin here buys a fresh Explore sweep there.]
**Must not touch:** [Explicitly out of scope]

### Phase 2: [Name]
**Scope:** [...]
**User-testable outcome(s):** [...]
**Technical deliverables:** [...]
**Context pointers:** [...]
**Must not touch:** [...]

[...continue through Phase N...]

## Definition of Done
[User-perspective acceptance criteria for the complete feature]
---

## Step 4 — Verify the issue is runnable

`/run` consumes this issue by exact heading, and nothing else checks that coupling. Read the posted body
back with `gh issue view <n>` and confirm:

- the top-level headings are present and spelled exactly as above — `/run` looks for them literally;
- every phase block carries all five fields. A missing **Context pointers** is the expensive one: it
  costs `/run` a fresh Explore sweep for that phase, which is the whole thing Step 1 paid to avoid;
- the paths in **Context pointers** actually exist — check them. A `file:line` written from memory is
  worse than no pointer at all, because `/run` will trust it and read the wrong thing.

Fix anything wrong with `gh issue edit` before handing it over.

Then share the issue URL and ask me to confirm **Intended Experience** before any implementation starts.
