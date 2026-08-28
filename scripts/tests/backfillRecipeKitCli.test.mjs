// Regression for the review's blocking finding (PR #1067, issue #954): `--verify`
// combined with `--apply` prints the APPLY banner (the ternary at the top of
// backfill-recipe-kit.mjs never looks at `args.verify`) and then the new verify
// block `process.exit`s — before the production confirm gate and before the write
// loop. Nothing is written. Worse, in the pre-remediation state every cookable
// recipe still carries the `kitInferredAt` its pre-#954 inference left, so the
// listing prints "done" for all of them and exits 0 — an operator reading an APPLY
// banner, a clean sweep and a green exit walks away from a library that was never
// touched. The combination must be refused outright, and the banner must never
// claim APPLY when it is not one.
//
// Spawned as a real subprocess rather than imported: the module runs its argument
// handling as top-level side effects (it is a CLI, not a library), so the only way
// to observe `process.exit` and stdout/stderr together is to run it. The die()
// this test pins must fire before the `gcloud auth print-access-token` call, so it
// needs no network and no gcloud on PATH — this sandbox has neither.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'backfill-recipe-kit.mjs',
);

function run(args) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

describe('backfill-recipe-kit.mjs CLI: --verify and --apply are mutually exclusive', () => {
  it('refuses the exact review reproduction before printing an APPLY banner or touching gcloud', () => {
    const result = run([
      '--project',
      'prod',
      '--apply',
      '--redo',
      '--confirm',
      'production',
      '--verify',
    ]);

    // Refused: non-zero exit, and no write plan or verify listing ever printed.
    expect(result.status).not.toBe(0);
    // The specific bug: the Mode banner must never claim APPLY when --verify was
    // also passed (pre-fix, this line prints before the verify block's exit(1),
    // because the verify block runs after the banner).
    expect(result.stdout).not.toMatch(/Mode\s*:\s*APPLY/);
    // Refused by name, not merely "died for some reason" — every die() call
    // prints a usage block that lists both `--apply` and `--verify` on one line
    // (`[--apply] [--verify]`), so a loose "mentions both flags" regex passes
    // even against the unrelated "no gcloud on PATH" die() this sandbox hits by
    // default. Pin the actual complaint instead.
    expect(result.stderr).toMatch(/--verify.*cannot be combined with.*--apply/i);
    // And it must be refused BEFORE the gcloud token fetch — this sandbox has no
    // gcloud on PATH, so reaching that call produces its own die() ("Could not
    // get a gcloud access token"), which would otherwise make this test pass for
    // the wrong reason.
    expect(result.stderr).not.toMatch(/gcloud access token/);
  });
});
