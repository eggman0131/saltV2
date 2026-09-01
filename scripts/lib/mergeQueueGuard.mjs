// The merge queue's failure mode, made mechanical.
//
// GitHub's merge queue builds each queued PR onto current `main` on a
// `gh-readonly-queue/main/...` ref and waits for the branch's REQUIRED STATUS
// CHECKS to report there. A required context that never reports on a
// `merge_group` event does not fail the entry — it leaves it pending until the
// queue's check timeout, then ejects it. Silently, and for every PR, forever.
// `ci.yml` asserts in a comment that this cannot happen. These functions are
// what make that assertion true rather than merely stated.
//
// THE LIMIT, stated because it cannot be closed (CLAUDE.md rule 12): this file
// MIRRORS the ruleset, it cannot read it. CI must not depend on a network call,
// so `REQUIRED_CONTEXTS` below is a hand-kept copy. It catches the direction
// that actually happens — someone renames a job, or adds a workflow-level
// trigger and forgets `merge_group` — and it is blind to the other one: a
// context added to the ruleset in the GitHub UI and to nothing else. Re-check
// the copy against the live ruleset when you change either:
//
//   gh api repos/eggmanorg/salt/rulesets/16697241 \
//     --jq '.rules[] | select(.type=="required_status_checks")
//           | .parameters.required_status_checks[].context'

/** The `Main` ruleset's three required status checks. All three are produced by
 *  aggregator jobs in ci.yml whose names are load-bearing for exactly this
 *  reason — see the comments on `ci` and `e2e` there before renaming one. */
export const REQUIRED_CONTEXTS = [
  'Lint, typecheck, test, boundary',
  'Vitest integration (emulator)',
  'E2E (Playwright)',
];

/** Drop whole-line comments. Every check below asks "is this key present?", and
 *  a key inside a comment is not present — #1074 reverted a `merge_group:`
 *  trigger whose surrounding comments long outlived it, so this distinction is
 *  not hypothetical. */
const stripComments = (text) =>
  text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

/** The workflow's `on:` block: from `on:` to the next top-level key. */
export function onBlock(text) {
  const lines = stripComments(text).split('\n');
  const start = lines.findIndex((line) => /^on:/.test(line));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^[A-Za-z]/.test(line));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join('\n');
}

/** Job-level `name:` values — exactly four spaces of indent. A step's name is
 *  written `      - name:` and a workflow's at column 0, so neither collides. */
export function jobNames(text) {
  return [...stripComments(text).matchAll(/^ {4}name: (.+)$/gm)].map((m) => m[1].trim());
}

export const triggersMergeGroup = (text) => {
  const block = onBlock(text);
  return block !== null && /^\s*merge_group:/m.test(block);
};

/** Whether the workflow triggers on a push to `main`. `deploy-staging.yml`
 *  chains off this workflow's completion (`workflow_run`, `branches: [main]`),
 *  so losing the trigger silently stops every staging deploy — a merge queue
 *  does NOT replace it, because the queue's own runs happen on the readonly
 *  queue ref and never on `main`. */
export function triggersPushToMain(text) {
  const block = onBlock(text);
  if (block === null) return false;
  const lines = block.split('\n');
  const start = lines.findIndex((line) => /^ {2}push:/.test(line));
  if (start === -1) return false;

  const named = (value) => value.trim().replace(/['"]/g, '') === 'main';
  let inBranches = false;

  for (const line of lines.slice(start + 1)) {
    if (/^ {0,2}\S/.test(line)) break; // dedented out of the `push:` block

    // Inline form, which is what ci.yml uses: `branches: [main]`.
    const inline = line.match(/^ {4}branches:\s*\[(.*)\]/);
    if (inline) return inline[1].split(',').some(named);

    // Block-sequence form, equally valid YAML and what a reformat could
    // produce. Reading only the inline form would turn a cosmetic edit into a
    // spurious failure, and a guard that cries wolf gets switched off.
    //   branches:
    //     - main
    if (/^ {4}branches:\s*$/.test(line)) {
      inBranches = true;
      continue;
    }
    if (inBranches) {
      const item = line.match(/^ {6}- (.+)$/);
      if (item) {
        if (named(item[1])) return true;
        continue;
      }
      inBranches = false; // some other key under `push:`
    }
  }
  return false;
}

/** A merge_group run that gets cancelled is an ejected queue entry. A literal
 *  `cancel-in-progress: true` cancels every event; the expression form that
 *  narrows it to pull_request is what ci.yml uses and what this permits. */
export const cancelsEveryEvent = (text) =>
  /^\s*cancel-in-progress:\s*true\s*$/m.test(stripComments(text));

/**
 * @param {{path: string, text: string}[]} workflows
 * @param {string[]} requiredContexts
 * @returns {string[]} problems, empty when the queue cannot be jammed
 */
export function auditMergeQueue(workflows, requiredContexts = REQUIRED_CONTEXTS) {
  const problems = [];
  const owners = new Map(workflows.map((w) => [w.path, jobNames(w.text)]));

  for (const context of requiredContexts) {
    const owning = workflows.filter((w) => owners.get(w.path).includes(context));

    if (owning.length === 0) {
      problems.push(
        `Required status check "${context}" is not the name of any job in .github/workflows/. ` +
          `Nothing will ever report it, so every PR — and every merge-queue entry — blocks forever. ` +
          `Restore the job name, or update the ruleset and REQUIRED_CONTEXTS together.`,
      );
      continue;
    }
    if (owning.length > 1) {
      problems.push(
        `Required status check "${context}" is claimed by ${owning.length} workflows ` +
          `(${owning.map((w) => w.path).join(', ')}). Which one satisfies the ruleset is then a race. ` +
          `Rename all but one.`,
      );
    }

    for (const workflow of owning) {
      if (!triggersMergeGroup(workflow.text)) {
        problems.push(
          `${workflow.path} produces required status check "${context}" but has no \`merge_group:\` trigger. ` +
            `The queue would wait on a context that never reports, then eject the entry at the check timeout. ` +
            `Add \`merge_group:\` to its \`on:\` block.`,
        );
      }
      if (cancelsEveryEvent(workflow.text)) {
        problems.push(
          `${workflow.path} sets \`cancel-in-progress: true\` unconditionally, which cancels merge_group runs too — ` +
            `a cancelled required check ejects the queue entry. Narrow it to the events you mean to cancel.`,
        );
      }
    }
  }

  const ci = workflows.find((w) => w.path.endsWith('ci.yml'));
  if (ci && !triggersPushToMain(ci.text)) {
    problems.push(
      `${ci.path} no longer triggers on \`push:\` to \`main\`. deploy-staging.yml chains off this workflow's ` +
        `completion on main, and merge-queue runs happen on the readonly queue ref, never on main — ` +
        `so dropping this trigger silently stops every staging deploy.`,
    );
  }

  return problems;
}
