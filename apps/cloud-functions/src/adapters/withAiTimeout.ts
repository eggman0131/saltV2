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

// The house budget for a one-shot TEXT flow: a single 55s attempt with no
// automatic retry. Used verbatim at every text flow that wants it, so the
// number lives here rather than being copied into each call (issue #915 —
// it was written out by hand at nine sites, and a comment at one of them
// already called it "house text-flow values").
//
// 55s rather than the 20s default: a pro-tier structured generation routinely
// runs past 20s, and a retry of a long call would not fit the 90–120s function
// quota these flows are exported with. No retry: every one of them is either a
// human pressing a button they can press again, or a trigger that treats a
// failure as "not yet" and retries on the next write.
//
// A site that deliberately wants different values (the image flows' 60s + 1
// retry, generateChatTitle's 15s) keeps its own literal — the constant is for
// the ones that agree, not a lid on the ones that do not.
export const AI_TEXT_FLOW_TIMEOUT = { timeoutMs: 55_000, retries: 0 } as const;

// A STREAMED answer is bounded by silence, not by total duration. A chef reply
// that keeps producing tokens for two minutes is healthy, and capping its total
// length would truncate a good answer; what is never healthy is a stream that
// stops delivering and never ends. So the deadline is the longest gap we accept
// BETWEEN chunks (and before the first one) — the same budget a non-streaming
// text flow gets for its whole call, which sits well inside the 120s quota the
// one streaming callable is exported with.
export const AI_STREAM_IDLE_TIMEOUT_MS = AI_TEXT_FLOW_TIMEOUT.timeoutMs;

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

/**
 * The streaming counterpart of `withAiTimeout`, for `ai.generateStream`.
 *
 * `withAiTimeout` cannot guard a stream. Wrapping the aggregated response
 * promise puts the deadline AFTER the drain loop, so a model that goes quiet
 * mid-stream never reaches it and holds the function for its whole quota —
 * exactly the hang that shipped in chefChat (issue #915, finding A5-001).
 *
 * This wraps the ITERATION instead: every `next()` races an idle timer, so the
 * first silence longer than `idleMs` — including before the first chunk —
 * rejects with the same `AiTimeoutError` the non-streaming path throws, and the
 * caller's existing catch reports it and fails the turn. A stream that keeps
 * delivering is never interrupted however long the answer runs, so nothing that
 * worked before stops working.
 *
 * No retry: a partial answer has already been relayed to the client, so
 * re-running the call would repeat text the reader has seen.
 */
export async function* withAiStreamTimeout<T>(
  label: string,
  stream: AsyncIterable<T>,
  idleMs: number = AI_STREAM_IDLE_TIMEOUT_MS,
): AsyncGenerator<T> {
  const iterator = stream[Symbol.asyncIterator]();
  for (;;) {
    // As in raceWithTimeout: on a stall the losing `next()` is left dangling
    // rather than awaited closed. Asking a hung async generator to return()
    // queues behind that same pending next() and would re-create the hang this
    // exists to close.
    const next = await raceWithTimeout(label, () => iterator.next(), idleMs);
    if (next.done === true) return;
    yield next.value;
  }
}
