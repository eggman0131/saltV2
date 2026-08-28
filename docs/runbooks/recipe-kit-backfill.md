# Runbook — re-inferring the library's recipe kit (#954)

Owner of the mechanism: `scripts/backfill-recipe-kit.mjs`, `scripts/lib/recipeKitRequest.mjs`,
the `identifyRecipeKit` flow, and the kit branch of `onRecipeWritten`. **The reasoning
behind each of those lives beside the code** — this file holds only what the code cannot
say: the order the three environments are done in, the two ways a run silently does
nothing, and the one judgement call the run exists to settle.

## What this is remediating

Before #954 the kit flow was told `no brand names`, and the appliance clause named
`"food processor"` as the *desired* output form. So a method that says
*"Run the **Magimix Cook Expert** on a slow cook setting"* was stored as `slow cooker`,
and *"the straight blade on your **OXO Good Grips Chef's Mandoline**"* as `mandoline` —
in a kitchen holding **two mandolines** and **four-plus things that answer to "food
processor"**. The names were discarded, not unknown: they were in the text the flow was
handed.

Phases 1 and 2 fixed the flow (it is now handed the manifest and told never to
generalise a named appliance) and the display (an equipment-named label draws its own
`equipmentIcons` pictogram, resolved *before* `kitchenTools`). Nothing re-asks the
recipes already stored. This is that pass.

## Order, and why it is this order

The script does not infer anything. It PATCHes a `kitRequestedAt` nonce — and, under
`--redo`, deletes the `kitInferredAt` stamp — and the deployed `onRecipeWritten` trigger
does the work. So **the functions must be deployed to an environment before the script
is pointed at it.**

That is worse here than it is for the times backfill, and the difference is the reason
this paragraph exists. Pointed at a project whose functions predate #954, a `--redo` run
does not merely change nothing: the *old* flow answers, spending one AI call per recipe
to write the generalised label back again. Deploy first.

For each of `dev` → `staging` → `prod`, in that order:

1. **Deploy** the functions to that project. Confirm the kit branch carries #954 (the
   `equipment` field reaching `identifyRecipeKitFlow`) before continuing.
2. **Dry run** — lists what would be asked and, under `--redo`, the labels each recipe
   stores today, so you can see what you are about to replace:
   `node scripts/backfill-recipe-kit.mjs --project dev --redo --dry-run`
3. **Apply**: `node scripts/backfill-recipe-kit.mjs --project dev --apply --redo`
   (prod additionally needs `--confirm production`; there is no interactive prompt —
   see the script header for the scar behind that.)
4. **Wait a minute or two.** The script's last line is the request landing, not the
   answer. The kit lists arrive as the trigger works through them.
5. **Verify**: `node scripts/backfill-recipe-kit.mjs --project dev --verify`
   Exit code 0 means every cookable recipe is stamped. It also prints each recipe's
   stored labels — read a sample of those against the method text, because "is this the
   right appliance?" is a judgement no exit code can make.

Do not start `staging` until `dev` verifies clean, and do not start `prod` until
`staging` does. Dev is a copy of staging data and staging a copy of prod
([data-refresh.md](../data-refresh.md)), so each run is a rehearsal of the next on
realistic content.

## `--redo` is required here, and a bare `--apply` is not enough

A first-time backfill (#882's) skips anything already carrying `kitInferredAt`. Every
recipe this remediation is for carries one — that is what makes it wrong. So the
remediation run is `--apply --redo`, and `--redo` deletes the stamp rather than merely
bumping the nonce past it, because `kitNeedsInference` declines on its first line while
the stamp is present. The mechanism is in `scripts/lib/recipeKitRequest.mjs`; the point
here is only that **omitting `--redo` reports "0 to ask" and remediates nothing**, which
is exactly what a first attempt at this did.

## The two ways a run silently does nothing

1. **Functions not deployed** (above). Worse than a no-op: the old flow answers and
   re-writes the generalised labels. `--verify` shows every recipe `done` with the same
   labels it had — check the labels, not just the exit code.
2. **The recipe-generation kill-switch is off** for that environment
   (`devSettings/singleton.recipeImageGenerationEnabled`). It is the same lever that
   stops hero images and time estimates — deliberately one lever, not three — and the
   kit branch honours it. Symptom is every recipe left `PENDING` after a `--redo` pass,
   because the branch returns before inferring and the stamp stays deleted. Check the
   switch before assuming a deploy problem.

## What a verified run leaves behind

- `kit` rewritten and `kitInferredAt` re-stamped.
- **Nothing else.** The write is a field-level update on `kitRequestedAt` (plus the
  `kitInferredAt` delete under `--redo`), and the trigger's own write-back is a partial
  `.update()` of `kit` and `kitInferredAt`. Recipes are last-write-wins per whole
  document, so a full write from either place would clobber a concurrent save; neither
  makes one. `updatedAt` is deliberately not touched — nothing a human authored changed,
  and moving it would reorder every list.
- A recipe whose inference **fails** keeps `kitInferredAt` deleted and its previous
  `kit` in place, so the strip keeps showing something useful and `--verify` reports it
  `PENDING`. Re-run `--apply --redo`, or use **Redo kit** on that one recipe.

## The judgement call this run exists to settle

#954 left one question open deliberately, to be decided on real output rather than up
front: **may an accessory be named as kit?** The manifest models accessories with an
`owned` flag, and the evidence recipe's method names blades — *"the straight blade"*,
*"4 mm slicing disc"*. Naming them would be genuinely useful and needs no schema change;
it also risks a longer, noisier strip.

Judge it on the `staging --verify` output, before the production run. If it needs a
change, that is a prompt amendment in `identifyRecipeKit.ts`, deployed, and staging
re-run — not a change to this script. Record the decision on the issue either way.

The second open item is the **ASSUMPTION** in #954: when a method says only "food
processor" and several manifest items qualify, the prompt tells the flow to pick the best
fit for the job rather than stay generic. It is prompt wording only and cheap to reverse.
The staging sample is what confirms or refutes it.

## A single bad result

**Redo kit** on the recipe page re-asks one recipe (`redoRecipeKit`), which is the same
write this script makes under `--redo`. Reach for that rather than a second full pass.
