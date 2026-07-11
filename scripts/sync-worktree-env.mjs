#!/usr/bin/env node
// Copy the DEV env/secret files from the main working tree into a linked git
// worktree, so `pnpm dev` / `pnpm dev:genkit` / `pnpm dev:emulators` "just work"
// in a fresh worktree.
//
// WHY THIS EXISTS — dev config lives in GITIGNORED files (CF/AI secrets, the
// web app's Firebase config) that never come along when you `git worktree add`.
// A fresh worktree therefore has no `apps/cloud-functions/.secret.local` and no
// `apps/web-pwa/.env.development.local`, so the emulators run without secrets and
// the web app has no Firebase config. Same gitignore gap as `.emulator-data/`
// (handled by scripts/seed-emulator-admin.mjs) — this covers the env files.
//
// Behaviour:
//   * No-op unless we're in a LINKED worktree (in the main tree, source == dest).
//   * Copies each known dev env file from the main tree ONLY when it's missing
//     locally — it never overwrites a worktree-local file you've customised.
//     (To refresh a stale copy: delete it in the worktree and re-run a dev cmd.)
//   * Best-effort: a missing source or copy error is warned, never thrown, so it
//     can't break `pnpm dev`.

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Gitignored dev env/secret files, relative to the repo root. The derived
// dist/.secret.local copy is (re)created by dev:emulators, so it's not listed.
const ENV_FILES = ['apps/cloud-functions/.secret.local', 'apps/web-pwa/.env.development.local'];

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

let commonDir;
let gitDir;
let worktreeRoot;
try {
  commonDir = git('rev-parse', '--path-format=absolute', '--git-common-dir');
  gitDir = git('rev-parse', '--path-format=absolute', '--git-dir');
  worktreeRoot = git('rev-parse', '--show-toplevel');
} catch {
  // Not a git repo (or git unavailable) — nothing to sync.
  process.exit(0);
}

// In the main working tree, --git-dir === --git-common-dir; they differ only in
// a linked worktree, whose main root is the parent of the shared .git dir.
if (gitDir === commonDir) process.exit(0);
const mainRoot = path.dirname(commonDir);

for (const rel of ENV_FILES) {
  const dest = path.join(worktreeRoot, rel);
  if (fs.existsSync(dest)) continue; // never clobber a local customisation
  const src = path.join(mainRoot, rel);
  if (!fs.existsSync(src)) continue; // main tree lacks it too — nothing to copy
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`sync-worktree-env: copied ${rel} from the main working tree.`);
  } catch (err) {
    console.warn(`sync-worktree-env: failed to copy ${rel} (non-fatal): ${err?.message ?? err}`);
  }
}

process.exit(0);
