// The one claim scripts/backfill-recipe-times.mjs's header makes about the second
// pass that nothing else can check (issue #1210): "`--redo` still means what it
// always meant, and the two flags refuse to run together."
//
// It matters because the two select opposite sets. `--missing-phases` exists to
// ask ONLY the recipes with no phase strip, precisely so a strip a cook corrected
// by hand in #1202's editor is never overwritten; `--redo` asks every cookable
// recipe including those. Silently ranking one over the other would make an
// operator's typo cost a library's worth of AI calls and every hand-edited strip
// in it — so it is refused by name.
//
// Spawned as a real subprocess rather than imported, for the reason
// backfillRecipeKitCli.test.mjs states: the module runs its argument handling as
// top-level side effects. The die() pinned here fires before the `gcloud auth
// print-access-token` call, so it needs no network and no gcloud on PATH.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'backfill-recipe-times.mjs',
);

function run(args, env = {}) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

describe('backfill-recipe-times.mjs CLI: the second pass and --redo', () => {
  it('refuses --redo together with --missing-phases, by name and before touching gcloud', () => {
    const result = run(['--project', 'dev', '--missing-phases', '--redo', '--apply']);

    expect(result.status).not.toBe(0);
    // Refused by name rather than "died for some reason": every die() prints a
    // usage block naming both flags, so a loose regex would pass against the
    // unrelated "no gcloud on PATH" die() this sandbox hits by default.
    expect(result.stderr).toMatch(/--redo and --missing-phases select different recipes/);
    // And before the token fetch, or this test would pass for the wrong reason.
    expect(result.stderr).not.toMatch(/gcloud access token/);
    // Nothing that looks like a write plan was printed either.
    expect(result.stdout).not.toMatch(/Mode\s*:\s*APPLY/);
  });

  it('accepts --missing-phases on its own — it is a known flag, not an unknown one', () => {
    // Stopped deliberately at the project-name backstop rather than at the
    // gcloud token: that die is reached WITHOUT a network call and WITHOUT
    // gcloud on PATH, so this asserts a fixed point in the run rather than
    // depending on what the sandbox happens to lack. Getting that far is the
    // proof — a regression that dropped the flag from `parseArgs` would die at
    // `Unknown argument`, several checks earlier.
    const result = run(['--project', 'dev', '--missing-phases'], {
      SALT_DEV_PROJECT: 'deliberately-not-a-project',
    });

    expect(result.stderr).not.toMatch(/Unknown argument/);
    expect(result.stderr).toMatch(/does not look like dev/);
  });
});
