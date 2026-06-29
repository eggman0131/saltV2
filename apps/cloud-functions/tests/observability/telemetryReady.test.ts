import { describe, it, expect, vi, afterEach } from 'vitest';

// ─── CF telemetry-readiness gate (issue #370) ─────────────────────────────────
// The gate makes Firestore triggers await the async OTel pipeline (propagator +
// context manager) before extracting a supplied browser trace, so a cold-started
// handler doesn't silently drop it and re-root. These tests pin the three
// behaviours the triggers rely on: immediate when unarmed (unit/CLI), awaits the
// boot once armed, and degrades (never hangs) when the boot stalls or rejects.
//
// Module state is process-global, so each test re-imports under vi.resetModules()
// for isolation.

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

async function freshModule() {
  vi.resetModules();
  return import('../../src/observability/telemetryReady.js');
}

describe('whenCfTelemetryReady', () => {
  it('resolves immediately when telemetry was never armed (unit tests / CLI never block)', async () => {
    const { whenCfTelemetryReady } = await freshModule();
    await expect(whenCfTelemetryReady()).resolves.toBeUndefined();
  });

  it('blocks until the armed telemetry boot promise settles, then resolves immediately', async () => {
    const { armCfTelemetry, whenCfTelemetryReady } = await freshModule();

    let bootDone!: () => void;
    armCfTelemetry(
      new Promise<void>((resolve) => {
        bootDone = resolve;
      }),
    );

    let resolved = false;
    const waiting = whenCfTelemetryReady().then(() => {
      resolved = true;
    });

    // Still booting → the gate is open and the trigger is held.
    await Promise.resolve();
    expect(resolved).toBe(false);

    bootDone();
    await waiting;
    expect(resolved).toBe(true);

    // Warm now → subsequent calls are immediate (no second wait per invocation).
    await expect(whenCfTelemetryReady()).resolves.toBeUndefined();
  });

  it('degrades via the timeout when the boot never settles (a stuck pipeline never hangs the trigger — Rule 10)', async () => {
    vi.useFakeTimers();
    const { armCfTelemetry, whenCfTelemetryReady } = await freshModule();

    armCfTelemetry(new Promise<void>(() => {})); // never settles

    let resolved = false;
    const waiting = whenCfTelemetryReady(5_000).then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(4_999);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(resolved).toBe(true);
  });

  it('settles (resolves) when the telemetry boot promise rejects — broken telemetry → root trace, not a stuck trigger', async () => {
    const { armCfTelemetry, whenCfTelemetryReady } = await freshModule();

    armCfTelemetry(Promise.reject(new Error('telemetry init failed')));

    await expect(whenCfTelemetryReady()).resolves.toBeUndefined();
  });
});
