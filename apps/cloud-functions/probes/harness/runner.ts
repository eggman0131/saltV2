// Probe runner (issue #722) — the three properties that let this run
// repeatedly against a prod-restored environment:
//
//   1. Run-scoped isolation. Every document a probe creates is named
//      `probe-<runId>-…` and deleted in a `finally`. No probe asserts on global
//      state (list counts, "the first recipe").
//   2. Derive expectations, never hardcode them.
//   3. Never assert on AI prose — structural invariants only. A semantic
//      judgement is recorded with `warn()`, which never fails the run.
//
// Structured JSON goes to stdout (for the orchestrating agent); human-readable
// progress goes to stderr, so stdout stays machine-parseable.

import { randomBytes } from 'node:crypto';

import type { ProbeAdmin, ProbeIdentity } from './auth.js';
import type { ProbeEnv } from './env.js';

/** Every probe-created document id carries this prefix. Teardown enforces it. */
export const PROBE_PREFIX = 'probe-';

export interface ProbeStep {
  readonly name: string;
  readonly ok: boolean;
  readonly durationMs: number;
  readonly detail?: string;
}

export interface ProbeReport {
  readonly probe: string;
  readonly target: string;
  readonly projectId: string;
  readonly runId: string;
  readonly ok: boolean;
  readonly durationMs: number;
  readonly steps: ProbeStep[];
  readonly warnings: string[];
  readonly teardownErrors: string[];
  readonly failure: string | null;
}

export class ProbeAssertionError extends Error {}

/** Hard assertion — fails the step, and with it the probe. */
export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ProbeAssertionError(message);
}

export interface SettleOptions {
  /** Total budget before the trigger is declared not to have settled. */
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
}

export interface ProbeContext {
  readonly env: ProbeEnv;
  readonly admin: ProbeAdmin;
  readonly identity: ProbeIdentity;
  readonly runId: string;

  /** Run-scoped document id — `probe-<runId>-<suffix>`. */
  id(suffix: string): string;
  /** A hard step: any throw fails the probe. */
  step<T>(name: string, fn: () => Promise<T>): Promise<T>;
  /** A soft observation — recorded, never fatal. For semantic judgements. */
  warn(message: string): void;
  /** Register teardown, run LIFO in the `finally`. */
  cleanup(name: string, fn: () => Promise<void>): void;
  /** Register a probe-created document for guarded deletion. */
  track(collectionPath: string, docId: string): void;
  /**
   * Layer 2 — poll until `probe` returns a non-null value, or fail on the
   * deadline. Never a fixed sleep.
   */
  settle<T>(name: string, probe: () => Promise<T | null>, options?: SettleOptions): Promise<T>;
}

const DEFAULT_SETTLE_TIMEOUT_MS = 90_000;
const DEFAULT_SETTLE_INTERVAL_MS = 2_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function newRunId(): string {
  return `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
}

export interface RunProbeArgs {
  readonly name: string;
  readonly env: ProbeEnv;
  readonly admin: ProbeAdmin;
  readonly identity: ProbeIdentity;
  readonly body: (ctx: ProbeContext) => Promise<void>;
}

export async function runProbe(args: RunProbeArgs): Promise<ProbeReport> {
  const { name, env, admin, identity, body } = args;

  const runId = newRunId();
  const startedAt = Date.now();
  const steps: ProbeStep[] = [];
  const warnings: string[] = [];
  const teardownErrors: string[] = [];
  const teardown: { name: string; fn: () => Promise<void> }[] = [];
  let failure: string | null = null;

  const log = (line: string): void => {
    process.stderr.write(`${line}\n`);
  };

  const ctx: ProbeContext = {
    env,
    admin,
    identity,
    runId,

    id: (suffix) => `${PROBE_PREFIX}${runId}-${suffix}`,

    async step(stepName, fn) {
      const stepStart = Date.now();
      try {
        const value = await fn();
        steps.push({ name: stepName, ok: true, durationMs: Date.now() - stepStart });
        log(`  ok   ${stepName}`);
        return value;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        steps.push({ name: stepName, ok: false, durationMs: Date.now() - stepStart, detail });
        log(`  FAIL ${stepName}: ${detail}`);
        throw error;
      }
    },

    warn(message) {
      warnings.push(message);
      log(`  warn ${message}`);
    },

    cleanup(cleanupName, fn) {
      teardown.push({ name: cleanupName, fn });
    },

    track(collectionPath, docId) {
      // Blast-radius guard: dev and staging hold prod-restored data, so the
      // harness may only ever delete something it created itself.
      if (!docId.startsWith(PROBE_PREFIX)) {
        throw new ProbeAssertionError(
          `refusing to track "${collectionPath}/${docId}" for deletion — not a ${PROBE_PREFIX}* document`,
        );
      }
      teardown.push({
        name: `delete ${collectionPath}/${docId}`,
        fn: async () => {
          await admin.firestore.collection(collectionPath).doc(docId).delete();
        },
      });
    },

    async settle(settleName, probeFn, options = {}) {
      const timeoutMs = options.timeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS;
      const intervalMs = options.intervalMs ?? DEFAULT_SETTLE_INTERVAL_MS;
      const deadline = Date.now() + timeoutMs;

      return ctx.step(settleName, async () => {
        let attempts = 0;
        for (;;) {
          attempts += 1;
          const value = await probeFn();
          if (value !== null) return value;
          if (Date.now() >= deadline) {
            throw new ProbeAssertionError(
              `did not settle within ${timeoutMs}ms (${attempts} polls)`,
            );
          }
          await sleep(intervalMs);
        }
      });
    },
  };

  log(`probe ${name} → ${env.target} (${env.projectId}) runId=${runId}`);

  try {
    await body(ctx);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    // LIFO, and every teardown runs even if an earlier one throws — a probe
    // must never leave documents behind in a prod-restored environment.
    for (const entry of teardown.reverse()) {
      try {
        await entry.fn();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        teardownErrors.push(`${entry.name}: ${detail}`);
        log(`  teardown FAILED ${entry.name}: ${detail}`);
      }
    }
  }

  return {
    probe: name,
    target: env.target,
    projectId: env.projectId,
    runId,
    ok: failure === null,
    durationMs: Date.now() - startedAt,
    steps,
    warnings,
    teardownErrors,
    failure,
  };
}
