import { logger } from 'firebase-functions';

// Client-side deadline + single retry for outbound AI (Genkit/Gemini) calls.
// The Genkit flow promises have no built-in timeout, so a stalled upstream
// socket never rejects — it just hangs until the Cloud Functions runtime kills
// the whole invocation (~60s in the emulator) with a "socket hang up". This
// wrapper races each attempt against a timer so a stall surfaces as a normal
// rejection. The stall is per-connection (bimodal: a call either returns in a
// few seconds or hangs to the wall), so a single retry on a fresh call almost
// always recovers it before the adapter's catch maps the failure to a
// transient NetworkError (→ matchState 'failed').
//
// 20s exceeds a healthy generate call (slowest observed legit run was ~10s)
// while keeping the worst case (timeout + retry timeout = ~40s) under the 60s
// function timeout.
export const AI_CALL_TIMEOUT_MS = 20_000;
export const AI_CALL_RETRIES = 1;

export class AiTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'AiTimeoutError';
  }
}

interface WithAiTimeoutOptions {
  readonly timeoutMs?: number;
  readonly retries?: number;
}

async function raceWithTimeout<T>(label: string, op: () => Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AiTimeoutError(label, ms)), ms);
  });
  try {
    // The losing promise is left dangling on a stall — acceptable; the function
    // returns its result and the orphaned request settles or is reaped when the
    // worker is paused.
    return await Promise.race([op(), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function withAiTimeout<T>(
  label: string,
  op: () => Promise<T>,
  { timeoutMs = AI_CALL_TIMEOUT_MS, retries = AI_CALL_RETRIES }: WithAiTimeoutOptions = {},
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await raceWithTimeout(label, op, timeoutMs);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        logger.warn(`${label}: AI call failed, retrying`, {
          attempt: attempt + 1,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  throw lastErr;
}
