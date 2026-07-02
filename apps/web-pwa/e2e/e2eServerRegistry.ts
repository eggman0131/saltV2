import { execSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

// The e2e Vite server on :5174 is HOST-GLOBAL (one server per port across every
// worktree/checkout on this machine — Playwright does not manage it, issue #79).
// So its reuse sentinel is host-global too: a single file in the OS temp dir,
// keyed by port, NOT per-worktree. A server rooted at a different checkout, wired
// to different emulator ports, or built from a different git sha must NOT be
// reused — Vite serves files live from its cwd + env, so a mismatched server
// would silently serve the wrong app. The sentinel records the identity of the
// server we spawned so a later run can verify it before reusing.
export const SENTINEL_PATH = path.join(os.tmpdir(), 'salt-e2e-5174.json');

export interface E2eServerSentinel {
  pid: number;
  identity: string;
  port: number;
  createdAt: string;
}

export interface IdentityInputs {
  gitSha: string;
  appDir: string;
  emulatorEnv: Record<string, string>;
  ports: number[];
}

// A stable content hash of everything that determines whether a running :5174
// server is "ours". Emulator-env keys are serialized in sorted order so the hash
// is deterministic regardless of object key ordering.
export function computeIdentity(inputs: IdentityInputs): string {
  const sortedEnv: Record<string, string> = {};
  for (const key of Object.keys(inputs.emulatorEnv).sort()) {
    sortedEnv[key] = inputs.emulatorEnv[key] ?? '';
  }
  const canonical = JSON.stringify({
    gitSha: inputs.gitSha,
    appDir: inputs.appDir,
    emulatorEnv: sortedEnv,
    ports: inputs.ports,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

// `git rev-parse HEAD` in appDir. Best-effort: any git/exec failure yields an
// empty string rather than throwing, so a missing .git never blocks the suite.
export function gitShaOf(appDir: string): string {
  try {
    return execSync('git rev-parse HEAD', { cwd: appDir, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

export function readSentinel(): E2eServerSentinel | null {
  try {
    const raw = fs.readFileSync(SENTINEL_PATH, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as E2eServerSentinel).pid === 'number' &&
      typeof (parsed as E2eServerSentinel).identity === 'string' &&
      typeof (parsed as E2eServerSentinel).port === 'number' &&
      typeof (parsed as E2eServerSentinel).createdAt === 'string'
    ) {
      return parsed as E2eServerSentinel;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeSentinel(sentinel: E2eServerSentinel): void {
  try {
    fs.writeFileSync(SENTINEL_PATH, JSON.stringify(sentinel));
  } catch {
    // best-effort: a write failure just means the next run cannot verify reuse
    // and will re-spawn — correctness is preserved, only the fast path is lost.
  }
}

export function deleteSentinel(): void {
  try {
    fs.rmSync(SENTINEL_PATH, { force: true });
  } catch {
    // best-effort: nothing to clean up, or already gone.
  }
}

// True if the process is alive. `process.kill(pid, 0)` sends no signal — it only
// probes existence/permission. ESRCH => gone; any other error (e.g. EPERM) means
// the process exists but we can't signal it, which still counts as "alive".
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

// The pids listening on a TCP port, cross-platform (macOS + Linux). `lsof` exits
// non-zero when nothing matches, so the try/catch returns [] in that case. No
// `xargs` — macOS xargs lacks GNU `-r`, so an empty match would spawn a bare
// `kill` with no args.
export function pidsOnPort(port: number): number[] {
  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => Number.parseInt(line, 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    // lsof exits non-zero when no process matches (or lsof is absent).
    return [];
  }
}

// Best-effort signal to one pid. Never throws: the process may already be gone
// (ESRCH) or unkillable (EPERM), and a failed teardown kill must not mask the
// run's result (Rule 10 spirit — best-effort, never throws).
export function killPid(pid: number, signal: 'SIGTERM' | 'SIGKILL'): void {
  try {
    process.kill(pid, signal);
  } catch {
    // already gone or not ours — best effort.
  }
}

// Kill whatever listens on a TCP port. Precise first (the tracked sentinel pid,
// if supplied and still ours), then a port-scan via lsof to catch anything still
// bound. Never throws.
export function killPort(port: number, signal: 'SIGTERM' | 'SIGKILL', trackedPid?: number): void {
  if (typeof trackedPid === 'number' && trackedPid > 0) {
    killPid(trackedPid, signal);
  }
  for (const pid of pidsOnPort(port)) {
    if (pid !== trackedPid) killPid(pid, signal);
  }
}

// Poll until nothing listens on the port, or the timeout elapses. Returns true
// if the port is confirmed free. Used before a `--strictPort` spawn, which fails
// immediately if the port is still bound. Async so it never blocks the event loop.
export async function waitForPortFree(port: number, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pidsOnPort(port).length === 0) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return pidsOnPort(port).length === 0;
}
