#!/usr/bin/env node
// Proves the merge queue cannot be jammed by this repository's own workflows.
//
// The property being pinned is stated in ci.yml's `on:` block: "every required
// status check in the Main ruleset lives in this file, and a required context
// that never reports on a merge_group event blocks the queue forever". That is
// a safety claim, and until this script existed nothing made it true — a job
// rename or a lost trigger would have surfaced as queue entries timing out one
// by one, with no red check anywhere to explain why.
//
// The rules, and the reasoning behind each, are in scripts/lib/mergeQueueGuard.mjs
// — including the one limit this check cannot close (it mirrors the ruleset, it
// cannot read it).
//
// Run: pnpm mergequeue:check   (wired into ci.yml's `static` job)

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditMergeQueue, REQUIRED_CONTEXTS } from './lib/mergeQueueGuard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowDir = path.join(repoRoot, '.github', 'workflows');

const workflows = readdirSync(workflowDir)
  .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
  .map((file) => ({
    path: path.posix.join('.github/workflows', file),
    text: readFileSync(path.join(workflowDir, file), 'utf8'),
  }));

const problems = auditMergeQueue(workflows, REQUIRED_CONTEXTS);

if (problems.length === 0) {
  console.log(
    `Merge queue OK — ${workflows.length} workflows, ${REQUIRED_CONTEXTS.length} required contexts, each reporting on merge_group.`,
  );
  process.exit(0);
}

console.error(
  `Merge queue check failed (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n`,
);
for (const problem of problems) console.error(`  ${problem}\n`);
process.exit(1);
