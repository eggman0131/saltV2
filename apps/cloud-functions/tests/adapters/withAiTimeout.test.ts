/**
 * The AI deadline, and in particular the STREAMING one (issue #915).
 *
 * `withAiTimeout` races a promise. A stream is not a promise, and the shape that
 * shipped — drain the stream bare, then apply `withAiTimeout` to the aggregated
 * response afterwards — has no deadline at all where it matters: the wrapper is
 * not reached until the stream has already finished, so a model that goes quiet
 * mid-answer holds the function until the runtime kills it.
 *
 * What is pinned here is the distinction that fix rests on: a stream is bounded
 * by SILENCE, not by total duration. A long answer that keeps arriving must
 * never be cut short (that would change the success path); a silence longer than
 * the budget must fail fast.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('firebase-functions', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const { withAiStreamTimeout, withAiTimeout, AiTimeoutError, AI_TEXT_FLOW_TIMEOUT } =
  await import('../../src/adapters/withAiTimeout.js');

afterEach(() => {
  vi.useRealTimers();
});

/** A stream that emits `chunks`, waiting `gapMs` before each one. */
async function* paced(chunks: readonly string[], gapMs: number): AsyncGenerator<string> {
  for (const chunk of chunks) {
    await new Promise((resolve) => setTimeout(resolve, gapMs));
    yield chunk;
  }
}

async function drain(stream: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

describe('withAiStreamTimeout', () => {
  it('relays every chunk of a healthy stream, in order', async () => {
    const received = await drain(withAiStreamTimeout('test', paced(['a', 'b', 'c'], 0), 1_000));
    expect(received).toEqual(['a', 'b', 'c']);
  });

  it('does NOT cut short a long answer that keeps arriving', async () => {
    vi.useFakeTimers();
    // Ten chunks, each 900ms after the last: nine seconds of total duration
    // against a one-second budget. A total-duration cap would truncate this;
    // an idle budget must not, because the stream never goes quiet.
    const chunks = Array.from({ length: 10 }, (_, i) => `chunk${i}`);
    const promise = drain(withAiStreamTimeout('test', paced(chunks, 900), 1_000));
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(promise).resolves.toEqual(chunks);
  });

  it('rejects when the model goes quiet MID-stream, after relaying what arrived', async () => {
    vi.useFakeTimers();
    const relayed: string[] = [];
    // Two chunks, then silence for ever — the hang #915 closes.
    async function* stalls(): AsyncGenerator<string> {
      yield 'the ';
      yield 'chef ';
      await new Promise(() => {});
      yield 'never gets here';
    }
    const promise = (async () => {
      for await (const chunk of withAiStreamTimeout('chefChat', stalls(), 1_000)) {
        relayed.push(chunk);
      }
    })();
    const assertion = expect(promise).rejects.toThrow(AiTimeoutError);
    await vi.advanceTimersByTimeAsync(1_001);
    await assertion;
    // The reader keeps what was already delivered; only the stall fails.
    expect(relayed).toEqual(['the ', 'chef ']);
  });

  it('rejects when the FIRST chunk never arrives', async () => {
    vi.useFakeTimers();
    async function* never(): AsyncGenerator<string> {
      await new Promise(() => {});
      yield 'unreachable';
    }
    const promise = drain(withAiStreamTimeout('chefChat', never(), 1_000));
    const assertion = expect(promise).rejects.toThrow('chefChat timed out after 1000ms');
    await vi.advanceTimersByTimeAsync(1_001);
    await assertion;
  });

  it('propagates a mid-stream model error unchanged', async () => {
    async function* explodes(): AsyncGenerator<string> {
      yield 'a';
      throw new Error('model said no');
    }
    await expect(drain(withAiStreamTimeout('test', explodes(), 1_000))).rejects.toThrow(
      'model said no',
    );
  });

  it('defaults to the house budget when none is given', async () => {
    vi.useFakeTimers();
    async function* never(): AsyncGenerator<string> {
      await new Promise(() => {});
    }
    const promise = drain(withAiStreamTimeout('chefChat', never()));
    const assertion = expect(promise).rejects.toThrow(
      `chefChat timed out after ${AI_TEXT_FLOW_TIMEOUT.timeoutMs}ms`,
    );
    await vi.advanceTimersByTimeAsync(AI_TEXT_FLOW_TIMEOUT.timeoutMs + 1);
    await assertion;
  });
});

describe('AI_TEXT_FLOW_TIMEOUT', () => {
  it('is the one house text-flow budget, not a literal copied per flow', () => {
    expect(AI_TEXT_FLOW_TIMEOUT).toEqual({ timeoutMs: 55_000, retries: 0 });
  });

  it('is accepted by withAiTimeout as its options', async () => {
    await expect(withAiTimeout('test', async () => 'ok', AI_TEXT_FLOW_TIMEOUT)).resolves.toBe('ok');
  });
});
