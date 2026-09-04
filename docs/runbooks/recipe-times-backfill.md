# Runbook — re-estimating the library's recipe times (#952, #1210)

Owner of the mechanism: `scripts/backfill-recipe-times.mjs`, the `estimateRecipeTimes`
flow, and the times branch of `onRecipeWritten`. **The reasoning behind each of those
lives beside the code** — this file holds only what the code cannot say: the order the
three environments are done in, and the ways a run silently does nothing.

## Two passes, and which one you are running

The script has been pointed at the library twice, for two different gaps.

| Pass                 | Flag               | Asks the cookable recipes that…         | Status                                                                                                                                                              |
| -------------------- | ------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First (#952 phase 2) | _(none — default)_ | have no `timesEstimatedAt` stamp        | shipped, all three environments — but never "finished": it re-selects whatever is still unstamped each time it runs, including anything authored since the last run |
| Second (#1210)       | `--missing-phases` | have **no phase strip**, stamped or not | the one you are here to run                                                                                                                                         |

**If you are here to give every recipe a timeline, you want `--missing-phases`.** But run
the default pass too, before or alongside it. The default pass does **not** necessarily
report `To ask : 0`: it only skips a recipe that is already stamped, and any recipe
authored since the last default-pass apply has no stamp yet, so it still shows up there —
and `--verify`'s `pending` count for it never clears until the default pass runs again. A
stamp is still not evidence of a strip, so `--missing-phases` remains the flag that
actually fills in the timeline; the default pass is what keeps `--verify` reachable at
all. The script's `Select :` banner names which set it is about to ask; read it before
typing `--apply`.

## What this is remediating

**First pass (#952).** Every recipe authored before #952 phase 1 carried a prep time
produced by a prompt that never said what a prep time _is_. With only
`integers in minutes, or null` to go on, the model fell back on published-recipe
convention — the already-weighed counter, and no washing up — so Penne all'Arrabbiata
claimed **5 minutes** to fetch and chop garlic and chilli, open tomatoes, boil a pan and
grate cheese. A subset were also arithmetically impossible: Paneer Makhanwala stored prep
10, cook 35, **total 35**.

**Second pass (#1210).** #1122 replaced those three numbers with a phase strip —
`metadata.phases`, the blocks the recipe page draws a timeline from. Recipes authored
since then have one; everything older does not, and nothing has re-asked them. Issues
#1233 and #1211 then removed the three numbers a strip-less recipe used to fall back to,
so a recipe with no strip now shows **no timing at all** — which is why this pass has to
have finished in an environment before the strip can be relied on there.

## Order, and why it is this order

The script does not estimate anything. It PATCHes a `timesRequestedAt` nonce and the
deployed `onRecipeWritten` trigger does the work — so **the functions must be deployed
to an environment before the script is pointed at it.** That is the whole of the
sequencing risk, and it is invisible: pointed at a project whose functions predate this
change, the script reports a clean sweep having changed nothing.

For each of `dev` → `staging` → `prod`, in that order — the second pass runs the same
five steps as the first, with `--missing-phases` added to steps 2 and 3:

1. **Deploy** the functions to that project. Confirm the times branch is live before
   continuing.
2. **Dry run** — lists exactly the recipes that would be asked and writes nothing:
   `node scripts/backfill-recipe-times.mjs --project dev --missing-phases --dry-run`
   This is how the size of the job (and therefore the AI spend) is known before a single
   call is made.
3. **Apply**: `node scripts/backfill-recipe-times.mjs --project dev --missing-phases --apply`
   (prod additionally needs `--confirm production`; there is no interactive prompt —
   see the script header for the scar behind that.)
4. **Wait a minute or two.** The script's last line is the request landing, not the
   answer. The estimates arrive as the trigger works through them.
5. **Verify**: `node scripts/backfill-recipe-times.mjs --project dev --verify`
   Exit code 0 means every cookable recipe is stamped, **carries a phase strip**, and
   stores no `total < prep + cook`. Anything else prints what is outstanding, listed by
   id.

Do not start `staging` until `dev` verifies clean, and do not start `prod` until
`staging` does. Dev is a copy of staging data and staging a copy of prod
([data-refresh.md](../data-refresh.md)), so each run is a rehearsal of the next on
realistic content.

`--verify` takes no selection flag: it reports on the whole library, both passes at once.

### What the second pass selects, and what it leaves alone

It asks the cookable recipes with **no phase strip** — an absent `metadata.phases` and a
stored empty one both count as none, which is the same rule the app uses to decide whether
to draw a timeline (`recipePhaseTotals().hasPhases`; restated and tested in
`scripts/lib/recipePhaseStrip.mjs`). A strip whose minutes add up to zero is still a
strip.

Two consequences worth having in mind before you run it:

- **A recipe that already has a strip is never asked** — including one a cook corrected by
  hand in the phase editor. That is the point of selecting on the strip rather than
  re-asking everything, and it is why `--missing-phases` and `--redo` refuse to run
  together.
- **The pass is safe to re-run and safe to interrupt.** Ctrl-C it, run it again, and it
  picks up exactly the recipes still without a strip.

## The ways a run silently does nothing

1. **Functions not deployed** (above). The nonce lands, nothing listens, `--verify`
   shows every recipe still `PENDING`. Deploy and re-run `--apply`; the skip is keyed on
   `timesEstimatedAt`, so nothing is asked twice.
2. **The recipe-generation kill-switch is off** for that environment
   (`devSettings/singleton.recipeImageGenerationEnabled`). It is the same lever that
   stops hero images and kit inference — deliberately one lever, not three — and the
   times branch honours it. Symptom is identical to (1). Check the switch before
   assuming a deploy problem.
3. **Second pass only: you forgot `--missing-phases`.** The default selection is the
   stamp, not the strip, so a default run can print `To ask : 0` and `✔ Nothing to
do.` while the library still has no phase strips at all — which looks exactly like
   a finished job. The `Select :` banner and a `--verify` that still reports
   `No phase strip : <n> ✖` are how you catch it.
4. **A `--verify` `PENDING` recipe is not necessarily a broken deploy or a disabled
   kill-switch.** The default pass only stamps what is unstamped when it runs; a recipe
   authored after your last default-pass apply is genuinely, correctly `PENDING` until
   the default pass runs again — that is neither (1) nor (2), it is the ordinary gap
   between "authored" and "next default-pass run." Run the default pass (no
   `--missing-phases`) to close it, then `--missing-phases` for the strip.

## What a verified run leaves behind

- `metadata.phases` and `metadata.timingSummary` rewritten — the phase strip and its
  sentence (issue #1122) write unconditionally, with nothing guarding a strip already
  there — and `timesEstimatedAt` stamped. The three prep/cook/total fields are **not**
  written: #1233 stopped the trigger writing them and #1211 deleted them outright.
- **Nothing else.** The write is a field-level update on those paths (recipes are
  last-write-wins per whole document), and the flow has no output field for a title, an
  ingredient or a step, so `rawText`, steps, timers, tags, images, `createdBy` and
  `lastEditedBy` are not merely left alone — they are unreachable. `updatedAt` is
  deliberately not touched either: nothing a human authored changed, and moving it would
  reorder every list.
- A hand-tuned time, or a hand-edited phase strip, is overwritten **on any recipe the run
  asks**. Accepted in #952 for the numbers, and the same bargain covers the strip. The
  second pass narrows the exposure rather than removing it: it never asks a recipe that
  already has a strip, so a hand-edited one is not in its list at all — but `--redo`, and
  any later re-ask, still overwrite one.

What exit code 0 from `--verify` does **not** claim: that the strips are any good, or that
the other two environments are done. It says every cookable recipe in that one project is
stamped and stores a strip. (`--verify` also reports on any stale prep/cook/total values
still sitting in the stored documents; those are read-only leftovers that no longer reach
any screen, and LWW clears them on the next ordinary save.)

## Residue: recipes a re-ask does not fill

Expect a few. The model can answer and omit the strip. `phases` then stays `[]` and
`timingSummary` carries forward, so the recipe is left exactly as it was — and since
#1211 there is no prep/cook/total left for it to fall back on, so it shows no timing at
all. Those recipes stay in `--verify`'s `No phase strip` list and are selected again by
the next `--missing-phases` run, so nothing is lost, but the count stops falling.

When `--verify` still lists a handful after a second apply:

1. **Run the pass once more.** A different sampling of the model often answers. Cheap in
   AI calls — it only asks the recipes still missing a strip — and it writes nothing at
   all to a recipe whose answer omits one.
2. **If the same recipes survive a third pass, fix them by hand** in the recipe's phase
   editor (#1202 phase 2). Two or three named blocks with rough minutes is a better
   answer than none, and a hand-authored strip is exactly what this pass then leaves
   alone forever.

Do not reach for `--redo` to clear a residue — it re-asks the whole library, one AI call
per recipe, and overwrites every hand-edited strip on the way past.

## Asking again later

`--redo` re-asks recipes that already carry a stamp. It is the path for a deliberate
second pass after the definition in `recipeFieldRules.ts` changes — which is also the
only thing that should trigger one, since the definition is what the estimate is made
against. It cannot be combined with `--missing-phases`: the two select opposite sets, and
the script refuses rather than ranking one over the other.
