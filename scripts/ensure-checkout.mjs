#!/usr/bin/env node
// Make THIS checkout a working one: gitignored dev env files in place,
// dependencies installed, and — the invisible one — live git hooks.
//
// WHY THIS EXISTS — a checkout git has just created is not ready to work in. A
// linked worktree has no `node_modules` and none of the gitignored dev env
// files; a fresh clone has neither either. Worst and least visible, in BOTH
// cases the commit gates are DEAD: `.husky/_` is untracked (self-ignored), so
// in a worktree `core.hooksPath` points at a directory that does not exist
// there, and in a clone it is not set at all (husky's `prepare` writes it into
// `.git/config`, which is not cloned). Either way `pre-commit` (lint-staged,
// typecheck, depcruise) and `commit-msg` (commitlint) silently do nothing until
// something runs `pnpm install`. Running that install
// is what this script is for, and restoring the gates is why it is worth firing
// unconditionally rather than leaving it to whoever remembers.
//
// POSITION-AGNOSTIC BY DESIGN. It makes no judgement about where it is running;
// its two entry points decide that, because they see different things:
//   * `.husky/post-checkout` — the only hook git fires on `git worktree add`.
//     It applies the worktree-only guards (see the hook) before calling here.
//   * the `SessionStart` hook in `.claude/settings.json` — every Claude Code
//     session, local and cloud. A cloud session is a fresh `git clone` in a
//     managed VM, not a linked worktree, so no git hook in this repo can see
//     it; the repo's `.claude/settings.json` IS part of the clone and does
//     carry over (user-level `~/.claude/` does not).
// SessionStart fires on every start *and* resume, so the warm path below —
// installed already, lockfile unchanged — is what keeps it free to run always.
//
// BEST-EFFORT BY CONTRACT: every step is guarded, every failure is a warning on
// stderr, and the exit code is ALWAYS 0. A failed bootstrap must never block a
// `git worktree add` or a session start; you just get a warning and a checkout
// you have to `pnpm install` by hand.

import { execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const startedAt = Date.now();

function warn(message) {
  console.warn(`ensure-checkout: ${message}`);
}

let root;
try {
  root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
} catch {
  process.exit(0); // not a git repo (or git unavailable) — nothing to bootstrap
}

// 1. Gitignored dev env/secret files. Delegated to the existing script rather
//    than reimplemented: it owns the file list and the never-clobber rule, and
//    it is already a no-op outside a linked worktree (a clone has no main tree
//    to copy from), so it needs no positional check of its own here.
try {
  execFileSync(process.execPath, [path.join(root, 'scripts', 'sync-worktree-env.mjs')], {
    cwd: root,
    stdio: 'inherit',
  });
} catch (err) {
  warn(`env sync failed (non-fatal): ${err?.message ?? err}`);
}

// 2. Warm path. The stamp lives INSIDE node_modules on purpose: "are the
//    dependencies installed" and "were they installed from this lockfile" then
//    have a single answer that cannot go stale — blow away node_modules and the
//    stamp goes with it. Silent, because SessionStart injects stdout into the
//    agent's context and a no-op has nothing to say.
const stampFile = path.join(root, 'node_modules', '.salt-checkout-stamp');
let stamp = '';
try {
  stamp = crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(root, 'pnpm-lock.yaml')))
    .digest('hex');
} catch {
  // No readable lockfile — no warm path to take; let pnpm decide below.
}

if (stamp !== '') {
  let previous = '';
  try {
    previous = fs.readFileSync(stampFile, 'utf8').trim();
  } catch {
    // No stamp — cold checkout, or installed by something other than this script.
  }
  if (previous === stamp) process.exit(0);
}

// 3. Install. This is also what runs husky's `prepare` and restores `.husky/_`,
//    so it is the step that brings the commit gates back to life.
//    `--frozen-lockfile` keeps a bootstrap from quietly rewriting the lockfile;
//    `--prefer-offline` keeps it to the local store when the store is warm.
function resolvePnpm() {
  // `.husky/post-checkout` has already resolved pnpm with the repo's portable
  // hook preamble and passed it down; reuse that rather than resolving twice.
  const fromHook = (process.env.SALT_PNPM_BIN ?? '').trim();
  if (fromHook !== '') return fromHook.split(/\s+/);
  try {
    execFileSync('pnpm', ['--version'], { stdio: 'ignore' });
    return ['pnpm'];
  } catch {
    return ['corepack', 'pnpm']; // same fallback the husky hooks use
  }
}

const [bin, ...binArgs] = resolvePnpm();
try {
  execFileSync(bin, [...binArgs, 'install', '--frozen-lockfile', '--prefer-offline'], {
    cwd: root,
    stdio: 'inherit',
  });
} catch (err) {
  warn(
    `\`pnpm install\` failed (non-fatal): ${err?.message ?? err}\n` +
      'ensure-checkout: this checkout has no dependencies and NO WORKING GIT HOOKS — ' +
      'commits here are ungated. Run `pnpm install` once you have network or store access.',
  );
  process.exit(0);
}

try {
  if (stamp !== '') fs.writeFileSync(stampFile, `${stamp}\n`);
} catch (err) {
  // Only costs a redundant install next time, so it is not worth a warning
  // louder than this.
  warn(`could not write the warm-path stamp (non-fatal): ${err?.message ?? err}`);
}

const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(
  `ensure-checkout: checkout ready in ${seconds}s — dependencies installed, git hooks live.`,
);
process.exit(0);
