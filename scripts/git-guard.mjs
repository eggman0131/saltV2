#!/usr/bin/env node
// Refuse the three git commands that can destroy work or bypass the contract.
//
// WHY THIS EXISTS — CLAUDE.md already writes these rules down, and they were
// broken anyway: a scan of this project's session history found 14 bare
// `git stash` / `git stash pop` calls, 3 pushes straight to `main`, and 4
// `git push --no-verify`. A rule an agent has to REMEMBER is a rule that gets
// forgotten under pressure, which is exactly the "a cause is not closed until
// something prevents its recurrence" argument #913 makes about the codebase —
// applied to the tooling instead.
//
// The three shapes, and why each is worth a hard stop rather than a warning:
//
//   1. Bare `git stash`, `stash pop`, `stash clear`. The stash stack is SHARED
//      across every worktree and every concurrent session — `git stash pop`
//      restores AND DROPS the top entry, which may belong to another agent
//      mid-run. This is the only one here that silently destroys work that was
//      never committed anywhere, so it is unrecoverable. Tagged pushes and
//      `apply <sha>` are fine and stay allowed.
//   2. Pushing to `main`. Work belongs on a branch; CI is the gate.
//   3. `git push --no-verify`. Skips husky + lint-staged — that is pre-commit
//      lint, typecheck and depcruise, i.e. the machinery that ENFORCES the
//      architecture contract. Bypassing it defeats having a contract at all.
//
// Wired as a PreToolUse hook in .claude/settings.json, filtered to git commands
// so it does not spawn on every Bash call. Reads the hook payload on stdin and
// answers with a permission decision; anything it does not recognise passes
// through untouched. Lives in scripts/ beside ensure-checkout.mjs, which is the
// other piece of harness tooling this repo version-controls, and is tracked so
// every worktree gets it without setup.

// A command that MENTIONS `git stash pop` is not a command that RUNS it — a
// commit message, a doc heredoc or a grep for the string are all legitimate and
// must not be refused. (The first version of this file matched the raw string
// and blocked its own commit message.) So: drop heredoc bodies, split on shell
// operators, and judge only the segments that actually START with `git`.
const stripHeredocs = (s) =>
  s.replace(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?\n\s*\2\b/g, ' <<HEREDOC ');

const gitInvocations = (s) =>
  stripHeredocs(s)
    .split(/\n|;|&&|\|\||[|&]/)
    .map((seg) => seg.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, ''))
    .filter((seg) => /^git\s/.test(seg));

const RULES = [
    {
      re: /^git\s+stash\s+pop\b/,
      why: '`git stash pop` restores and DROPS the top stash entry, and the stash stack is shared across every worktree and session — that entry may be another agent\'s uncommitted work. Find yours by tag in `git stash list`, `git stash apply <sha>`, then drop it explicitly.',
    },
    {
      re: /^git\s+stash\s+clear\b/,
      why: '`git stash clear` wipes the whole stash stack, which is shared with every other worktree and session. Drop only your own entry, by sha.',
    },
    {
      re: /^git\s+stash\b(?!\s+(?:push|apply|list|show|branch|create|store|drop)\b)/,
      why: 'A bare `git stash` pushes onto a stack shared with every other worktree and session, where the next `pop` may take it. Use `git stash push -u -m "<unique-tag>"` and `git stash apply <sha>`, or set the work aside with a temporary WIP commit.',
    },
    {
      re: /^git\s+push\b.*?(?:\s|:)main(?:\s|$)/,
      why: 'Direct push to main. Cut a branch and open a PR — CI is the gate.',
    },
    {
      re: /^git\s+push\b.*--no-verify\b/,
      why: '`--no-verify` skips husky + lint-staged: pre-commit lint, typecheck and depcruise, which is how the architecture contract in CLAUDE.md is enforced. Fix what the hook reports instead of bypassing it.',
    },
];

const refuse = (cmd) => {
  const invocations = gitInvocations(cmd);
  for (const { re, why } of RULES) {
    if (invocations.some((seg) => re.test(seg))) return why;
  }
  return null;
};

// `node scripts/git-guard.mjs --selftest` — the cases are here rather than in a
// vitest suite because this file has no imports and runs outside the workspace
// graph; a standalone script keeps its own proof. The MENTION cases are the
// load-bearing ones: an early version matched the raw command string and
// refused its own commit message.
if (process.argv.includes('--selftest')) {
  const CASES = [
    ['DENY', 'git stash'],
    ['DENY', 'git stash -q'],
    ['DENY', 'git stash pop'],
    ['DENY', 'git stash pop stash@{0}'],
    ['DENY', 'git stash clear'],
    ['DENY', 'git push origin main'],
    ['DENY', 'git push -u origin main'],
    ['DENY', 'git push origin HEAD:main'],
    ['DENY', 'git push --force origin main'],
    ['DENY', 'git push --no-verify -u origin feat/x'],
    ['DENY', 'git push -u origin feat/x --no-verify'],
    ['DENY', 'git add -A && git push origin main'],
    ['DENY', 'git fetch ; git stash pop'],
    ['DENY', 'GIT_EDITOR=true git stash'],
    ['PASS', 'git stash list'],
    ['PASS', 'git stash push -u -m mytag'],
    ['PASS', 'git stash apply abc123'],
    ['PASS', 'git stash drop abc123'],
    ['PASS', 'git stash show'],
    ['PASS', 'git push -u origin chore/git-guard-hook'],
    ['PASS', 'git push -u origin feat/main-nav-redesign'],
    ['PASS', 'git push --force-with-lease origin tmp/spike'],
    ['PASS', 'git status'],
    ['PASS', 'git log --oneline -3'],
    ['PASS', 'pnpm lint'],
    // mentions, not invocations
    ['PASS', 'echo "never run git stash pop here"'],
    ['PASS', 'grep -rn "git push --no-verify" docs/'],
    ['PASS', 'git commit -m "explain why git stash pop is banned"'],
    ['PASS', 'git log --grep="git stash pop"'],
    ['PASS', 'git commit -F - <<MSG\nwhy git stash pop is refused\nMSG'],
  ];
  let failed = 0;
  for (const [want, cmd] of CASES) {
    const got = refuse(cmd) ? 'DENY' : 'PASS';
    if (got !== want) {
      failed++;
      console.error(`MISMATCH want=${want} got=${got}  ${cmd}`);
    }
  }
  console.log(`${CASES.length - failed}/${CASES.length} cases correct`);
  process.exit(failed ? 1 : 0);
}

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let cmd = '';
  try {
    cmd = JSON.parse(raw)?.tool_input?.command ?? '';
  } catch {
    process.exit(0); // unparseable payload is not ours to judge
  }

  const why = refuse(cmd);
  if (why) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: why,
        },
      }),
    );
  }
  process.exit(0);
});
