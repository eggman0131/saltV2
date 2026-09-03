# One-shot scripts

A one-shot script is run by hand, usually against a real Firestore project, usually once — and then
kept, because the record of what was done to production data is worth more than the file. Two
directories hold them, and they are not interchangeable:

| The script needs…                                                              | It goes in                      | Run with                     |
| ------------------------------------------------------------------------------ | ------------------------------- | ---------------------------- |
| `firebase-admin`, `@salt/domain`, or anything under `apps/cloud-functions/src` | `apps/cloud-functions/scripts/` | `pnpm exec tsx scripts/x.ts` |
| only Node, the Firestore REST API, or the emulator                             | `scripts/`                      | `node scripts/x.mjs`         |

The root `scripts/` directory is **untyped ESM by design** — it is outside the layer map, its
subjects resolve nothing from `apps/` or `packages/`, and
[`scripts/vitest.config.ts`](../scripts/vitest.config.ts) states that beside the `include` that
makes it so. Do not add TypeScript there to get a compiler; put the script in the cloud-functions
tree, where one already runs.

This doc holds the two things the code cannot tell a script author: what compiles the directory they
are writing in, and where the logic has to live for a test to reach it.

## 1. A script directory outside a build `tsconfig` is compiled by nothing

This is the script-directory sibling of **UT-G1** in [unit-test-spec.md](unit-test-spec.md), which
owns the same mechanism for test directories and scopes itself to them. The mechanism:

A package's `tsconfig.json` is its **build** config — `rootDir: "src"`, `composite`, emits to
`dist`. A composite project cannot see files outside its `rootDir`, and anything it did see would
land in the deployed bundle's tree. So `scripts/` is reachable only by a **separate `noEmit`
project, named in the root `typecheck` script**. Both halves, or neither counts: `#1118` found ten
TypeScript files in `apps/cloud-functions/scripts/` — six of them production-mutating — that no
compiler had ever read, while `pnpm lint` sat green over the same directory, structurally unable to
see a type error.

Today `apps/cloud-functions/tsconfig.scripts.json` is that project, and its header comment says what
each option is for. Nothing needs adding for a new `.ts` file in that directory; the `include` is
`scripts/**/*.ts`.

**Guarded, not merely written down** (CLAUDE.md rule 12).
[`scripts/tests/testsAreTypechecked.test.mjs`](../scripts/tests/testsAreTypechecked.test.mjs) reds
`pnpm test` if the config stops being named in `package.json`'s `typecheck`.

**What the guard does not reach**, stated rather than rounded up:

- **`packages/ui-components/scripts/`** — real TypeScript, in no config the root `typecheck` runs.
  Out of `#1118`'s scope and still open. The guard names its one directory explicitly instead of
  deriving the set from the tree (a knowing departure from UT-E1) precisely because deriving it
  would red on this.
- **`.mjs` files in the enrolled directory.** `allowJs` lets TypeScript _resolve_
  `kitchen-tool-vocabulary.mjs` and infer its exports; `checkJs` is off, so the `.mjs` itself is not
  typechecked.
- **A directory nobody has enrolled yet.** As with UT-G1, the absence of a config is invisible — it
  looks the same as a directory with no TypeScript in it. Adding the third such directory means
  adding it to the guard by hand.

## 2. The decisions go in `lib/`, the I/O stays disposable

A one-shot script is throwaway; the _judgement_ inside it usually is not. Split them:

- **`lib/<name>.ts|.mjs`** — a pure function taking the rows and returning the plan. No
  `firebase-admin`, no `process.env`, no `console`. This is the half a test imports.
- **the script itself** — read, call the pure function, print, and write only behind `--apply`. Not
  tested, and not worth testing: it is credentials, a snapshot loop and a `console.table`.

The point is not coverage. A seeder or migration reaches for `firebase-admin`, Genkit and a Gemini
key **at import time**, so a test cannot import it at all without running the thing; extracting the
decision is the only way the judgement becomes assertable.

Both live precedents, one per directory:

| Decision layer (tested)                                                                                                                                                                                             | Disposable I/O                                                       | From  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----- |
| [`scripts/lib/ttlMigrationPlan.mjs`](../scripts/lib/ttlMigrationPlan.mjs) ← `scripts/tests/ttlMigrationPlan.test.mjs`                                                                                               | `scripts/migrate-ttl-timestamps.mjs`                                 | #1021 |
| [`apps/cloud-functions/scripts/lib/pruneInstanceNamedKitchenTools.ts`](../apps/cloud-functions/scripts/lib/pruneInstanceNamedKitchenTools.ts) ← `apps/cloud-functions/tests/pruneInstanceNamedKitchenTools.test.ts` | `apps/cloud-functions/scripts/prune-instance-named-kitchen-tools.ts` | #956  |

The second states the split in its own words, at its call site:

> The merge (live wins on id — a document curated since the table was written is the one the operator
> is looking at, and reporting the seed row's matchers instead would name phrases production does not
> hold) and the deletable/table-only partition both live in the pure function below, where a test can
> reach them.

Note what that names as the decision: not "the loop", but the _rule for resolving a disagreement
between two sources_. That is the test for what to extract. A script whose only decision is "read
every doc and write it back" has nothing to lift, and lifting a `lib/` module for it is ceremony.

**A `lib/` module is not disposable.** Once a test imports it, it is live code on the same footing
as anything under `src/` — it outlives the run that motivated it, and the compiler must see it. The
cloud-functions one is inside `tsconfig.scripts.json`'s `include`; the root one is `.mjs` and
deliberately is not.

## 3. Before writing one

- **Dry run by default.** Nothing is written without an explicit `--apply`; writing to prod takes a
  further gate. The backfill runbooks under [runbooks/](runbooks/) show the shape, and
  [#1067](https://github.com/eggmanorg/salt/issues/1067) is why the gate's _order_ matters — a
  `--verify` flag that exited before the confirm gate reported success having written nothing.
- **A non-TTY session cannot answer a `readline` prompt.** A production confirm gate hangs an agent
  after printing its whole write plan.
- **Say in the header what it did, where, and when.** The script's value after the run is the
  record. Every file in `apps/cloud-functions/scripts/` carries a `USAGE` block; copy that.
