#!/usr/bin/env node
// Refuse to run a HOST-GLOBAL command from a linked git worktree.
//
// WHY THIS EXISTS — a handful of scripts grab singletons that belong to the
// whole machine, not to a checkout: fixed ports, fixed docker-compose project
// names, the shared `.emulator-data` export, and the host-global `:5174` e2e
// Vite server. They take those singletons BLUNTLY — `scripts/free-ports.mjs` is
// a SIGTERM→SIGKILL on whatever is listening, and the `:5174` sentinel kills and
// respawns anything whose checkout identity does not match. Run from a worktree
// they therefore destroy something that is not theirs: an agent tidying up in a
// worktree silently kills the dev session Daniel is sitting in, or corrupts
// another agent's e2e run into a red that looks like a real defect.
//
// OWNERSHIP IS POSITIONAL AND STATELESS: the main working tree owns the host
// stacks, a linked worktree never does. No lock file, nothing to go stale, no
// release-on-exit path to get wrong — and it matches how the machine is used,
// because the main tree IS Daniel's dev environment.
//
// THREE POSITIONS, not two (see CLAUDE.md → Workflow → Worktree rules):
//   * main working tree     — owns the host stacks; runs freely, guard no-ops.
//   * linked worktree here  — owns nothing; refused, ask before taking the host.
//   * cloud VM              — owns the WHOLE machine; there is nobody to ask, so
//                             refusing would be wrong. A cloud session is a
//                             fresh clone, so the guard already no-ops there —
//                             but the harness can create a linked worktree
//                             INSIDE that VM, which would trip this guard for no
//                             reason. That case is handled by setting
//                             SALT_TAKE_HOST=1 in the cloud environment's
//                             environment variables, deliberately NOT by
//                             sniffing an env var in code: Remote Control
//                             sessions are "remote" while driving Daniel's
//                             actual machine, and that case must stay guarded.
//
// Deliberately a pnpm-script prefix rather than a Claude Code hook: it has to
// work for a human and for any agent harness, and it belongs in version control
// next to the scripts it protects.

import { execFileSync } from 'child_process';

const OVERRIDE = 'SALT_TAKE_HOST';

// What each guarded script actually seizes, in the user's terms. Keep these
// strings concrete — a refusal that cannot name what it protected reads as
// bureaucracy and gets overridden reflexively.
const DEV_EMULATOR_STACK = {
  owns: 'ports 4400, 8080, 9099 and 5001, plus the shared `.emulator-data` export',
  victim: "Daniel's dev emulator hub — and the export diverges into whichever tree ran last",
};

const GUARDED = {
  dev: {
    invocation: 'pnpm dev',
    owns: 'port 5173 (the dev web server)',
    victim: 'the dev server Daniel is sitting in — free-ports.mjs SIGTERMs whatever holds the port',
  },
  'dev:genkit': {
    invocation: 'pnpm dev:genkit',
    owns: 'ports 4001, 4033 and 3100 (Genkit dev UI, telemetry server, reflection server)',
    victim: "Daniel's running Genkit session",
  },
  'dev:emulators': { invocation: 'pnpm dev:emulators', ...DEV_EMULATOR_STACK },
  'stop:emulators': { invocation: 'pnpm stop:emulators', ...DEV_EMULATOR_STACK },
  'test:emulator': {
    invocation: 'pnpm test:emulator',
    owns: 'the `salt-vitest-emulators` compose project and host ports 8082/9101',
    victim: "another agent's integration run — `down -v` wipes the stack out from under it",
  },
  e2e: {
    invocation: 'pnpm --filter @salt/web-pwa e2e',
    owns: 'the `test-emulators` compose project, host ports 8081/9100/5002/4402, and the host-global `:5174` e2e Vite',
    victim:
      "another agent's e2e run — the :5174 sentinel kills and respawns on a checkout mismatch, and the red looks like a real defect",
  },
};
GUARDED['e2e:ui'] = { ...GUARDED.e2e, invocation: 'pnpm --filter @salt/web-pwa e2e:ui' };
GUARDED['e2e:coverage'] = {
  ...GUARDED.e2e,
  invocation: 'pnpm --filter @salt/web-pwa e2e:coverage',
};

const key = process.argv[2] ?? '';
const entry = GUARDED[key] ?? {
  invocation: `pnpm ${key}`.trim(),
  owns: 'a host-global resource (port, compose project or shared export)',
  victim: 'whoever is already using it',
};

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

let gitDir;
let commonDir;
let worktreeRoot;
try {
  gitDir = git('rev-parse', '--path-format=absolute', '--git-dir');
  commonDir = git('rev-parse', '--path-format=absolute', '--git-common-dir');
  worktreeRoot = git('rev-parse', '--show-toplevel');
} catch {
  process.exit(0); // not a git repo (or git unavailable) — nothing to protect
}

// Same test as scripts/sync-worktree-env.mjs and .husky/post-checkout, on
// purpose: the guard and the bootstrap must never disagree about where they are.
if (gitDir === commonDir) process.exit(0); // main working tree — it is the owner

if ((process.env[OVERRIDE] ?? '') !== '') {
  console.log(
    `host-guard: ${OVERRIDE} set — taking the host stacks for \`${entry.invocation}\` from a linked worktree.`,
  );
  process.exit(0);
}

const mainRoot = commonDir.replace(/\/\.git\/?$/, '');

process.stderr.write(
  `
✋ \`${entry.invocation}\` is refused here: this is a linked worktree.

   It would take   ${entry.owns}
   Which would hit ${entry.victim}
   Owned by        the main working tree — ${mainRoot}
   You are in      ${worktreeRoot}

   There is one dev stack and one of each test stack on this host, and they
   belong to the main tree. Nothing has been killed or wiped.

   Ask Daniel before taking the host over. Once he agrees:

       ${OVERRIDE}=1 ${entry.invocation}

   To validate your work without touching the host, all of these run freely
   right here, no permission needed:

       pnpm lint · typecheck · check · test · depcruise · boundary:test · format
       pnpm -r build          (there is no root \`build\` script)

`,
);

process.exit(1);
