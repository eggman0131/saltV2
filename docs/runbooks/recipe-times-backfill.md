# Runbook — re-estimating the library's recipe times (#952)

Owner of the mechanism: `scripts/backfill-recipe-times.mjs`, the `estimateRecipeTimes`
flow, and the times branch of `onRecipeWritten`. **The reasoning behind each of those
lives beside the code** — this file holds only what the code cannot say: the order the
three environments are done in, and the two ways a run silently does nothing.

## What this is remediating

Every recipe authored before #952 phase 1 carries a prep time produced by a prompt that
never said what a prep time *is*. With only `integers in minutes, or null` to go on, the
model fell back on published-recipe convention — the already-weighed counter, and no
washing up — so Penne all'Arrabbiata claims **5 minutes** to fetch and chop garlic and
chilli, open tomatoes, boil a pan and grate cheese. A subset are also arithmetically
impossible: Paneer Makhanwala stores prep 10, cook 35, **total 35**.

Phase 1 fixed the three authoring paths. Nothing re-asks the ~59 recipes already stored.
This is that pass.

## Order, and why it is this order

The script does not estimate anything. It PATCHes a `timesRequestedAt` nonce and the
deployed `onRecipeWritten` trigger does the work — so **the functions must be deployed
to an environment before the script is pointed at it.** That is the whole of the
sequencing risk, and it is invisible: pointed at a project whose functions predate this
change, the script reports a clean sweep having changed nothing.

For each of `dev` → `staging` → `prod`, in that order:

1. **Deploy** the functions to that project. Confirm the times branch is live before
   continuing.
2. **Dry run** — prints the current triple per recipe and writes nothing:
   `node scripts/backfill-recipe-times.mjs --project dev --dry-run`
3. **Apply**: `node scripts/backfill-recipe-times.mjs --project dev --apply`
   (prod additionally needs `--confirm production`; there is no interactive prompt —
   see the script header for the scar behind that.)
4. **Wait a minute or two.** The script's last line is the request landing, not the
   answer. The estimates arrive as the trigger works through them.
5. **Verify**: `node scripts/backfill-recipe-times.mjs --project dev --verify`
   Exit code 0 means every cookable recipe is stamped and none stores
   `total < prep + cook`. Anything else prints what is outstanding.

Do not start `staging` until `dev` verifies clean, and do not start `prod` until
`staging` does. Dev is a copy of staging data and staging a copy of prod
([data-refresh.md](../data-refresh.md)), so each run is a rehearsal of the next on
realistic content.

## The two ways a run silently does nothing

1. **Functions not deployed** (above). The nonce lands, nothing listens, `--verify`
   shows every recipe still `PENDING`. Deploy and re-run `--apply`; the skip is keyed on
   `timesEstimatedAt`, so nothing is asked twice.
2. **The recipe-generation kill-switch is off** for that environment
   (`devSettings/singleton.recipeImageGenerationEnabled`). It is the same lever that
   stops hero images and kit inference — deliberately one lever, not three — and the
   times branch honours it. Symptom is identical to (1). Check the switch before
   assuming a deploy problem.

## What a verified run leaves behind

- `metadata.prepTimeMinutes`, `metadata.cookTimeMinutes`, `metadata.totalTimeMinutes`
  rewritten, and `timesEstimatedAt` stamped.
- **Nothing else.** The write is a field-level update on those paths (recipes are
  last-write-wins per whole document), and the flow has no output field for a title, an
  ingredient or a step, so `rawText`, steps, timers, tags, images, `createdBy` and
  `lastEditedBy` are not merely left alone — they are unreachable. `updatedAt` is
  deliberately not touched either: nothing a human authored changed, and moving it would
  reorder every list.
- A hand-tuned time is overwritten. Accepted in #952: no field distinguishes a
  hand-tuned number from a generated one, and inventing one was rejected.

## Asking again later

`--redo` re-asks recipes that already carry a stamp. It is the path for a deliberate
second pass after the definition in `recipeFieldRules.ts` changes — which is also the
only thing that should trigger one, since the definition is what the estimate is made
against.
