import { describe, it, expect } from 'vitest';
import { summarizeMatchLog } from '@salt/domain';
import type { ArbitrationLog, MatchLogEntry, StageLog } from '@salt/domain';

function makeStage(overrides: Partial<StageLog> = {}): StageLog {
  return {
    stage: 1,
    stageName: 'exact_name',
    threshold: 1.0,
    passed: false,
    consideredCount: 5,
    durationMs: 10,
    topCandidates: [],
    bestScore: null,
    gap: null,
    skipReason: null,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<MatchLogEntry> = {}): MatchLogEntry {
  return {
    id: 'log-1',
    schemaVersion: 2,
    timestamp: '2026-05-03T00:00:00.000Z',
    rawInput: 'Chicken Breast',
    normalizedInput: 'chicken breast',
    inputItemCount: 20,
    totalDurationMs: 100,
    stages: [],
    finalDecision: 'created',
    finalItemId: null,
    finalItemName: null,
    surfacedCandidates: null,
    arbitration: null,
    ...overrides,
  };
}

function makeArbitration(overrides: Partial<ArbitrationLog> = {}): ArbitrationLog {
  return {
    reason: 'near_miss',
    candidatesIn: 2,
    aislesIn: 1,
    prompt: 'Which item is chicken breast?',
    rawResponse: '{"choice":"item-5"}',
    outcome: 'Chicken Breast',
    durationMs: 350,
    ...overrides,
  };
}

// ── oneLine ────────────────────────────────────────────────────────────────

describe('summarizeMatchLog — oneLine', () => {
  it('wraps rawInput in single quotes', () => {
    const { oneLine } = summarizeMatchLog(makeEntry());
    expect(oneLine).toContain("'Chicken Breast'");
  });

  it('includes finalDecision', () => {
    const { oneLine } = summarizeMatchLog(makeEntry({ finalDecision: 'matched' }));
    expect(oneLine).toContain('matched');
  });

  it('includes totalDurationMs', () => {
    const { oneLine } = summarizeMatchLog(makeEntry({ totalDurationMs: 142 }));
    expect(oneLine).toContain('142ms');
  });

  it('counts 0 near-miss when all stages are skipped', () => {
    const stages = [
      makeStage({ stage: 5, stageName: 'embedding', skipReason: 'no_items', bestScore: null }),
    ];
    const { oneLine } = summarizeMatchLog(makeEntry({ stages }));
    expect(oneLine).toContain('0 near-miss');
  });

  it('counts failed stages with a bestScore as near-misses', () => {
    const stages = [
      makeStage({
        stage: 2,
        stageName: 'token_overlap',
        threshold: 0.8,
        passed: false,
        bestScore: 0.75,
        gap: -0.05,
        consideredCount: 4,
      }),
      makeStage({
        stage: 3,
        stageName: 'synonym',
        threshold: 1.0,
        passed: true,
        bestScore: 1.0,
        gap: 0.0,
        consideredCount: 2,
      }),
    ];
    const { oneLine } = summarizeMatchLog(makeEntry({ stages, finalDecision: 'matched' }));
    expect(oneLine).toContain('1 near-miss');
  });

  it('counts all stages as near-miss when nothing passes (created)', () => {
    const stages = [
      makeStage({ stage: 1, stageName: 'exact_name', passed: false, bestScore: 0.9, gap: -0.1 }),
      makeStage({
        stage: 2,
        stageName: 'token_overlap',
        threshold: 0.8,
        passed: false,
        bestScore: 0.7,
        gap: -0.1,
      }),
    ];
    const { oneLine } = summarizeMatchLog(makeEntry({ stages, finalDecision: 'created' }));
    expect(oneLine).toContain('2 near-miss');
  });

  it('force-create path: all stages have no candidates, 0 near-miss', () => {
    const stages = [
      makeStage({ stage: 1, stageName: 'exact_name', passed: false, bestScore: null }),
      makeStage({
        stage: 2,
        stageName: 'token_overlap',
        threshold: 0.8,
        passed: false,
        bestScore: null,
      }),
    ];
    const { oneLine } = summarizeMatchLog(
      makeEntry({ stages, finalDecision: 'created', inputItemCount: 0 }),
    );
    expect(oneLine).toContain('0 near-miss');
  });
});

// ── multiLine — header ────────────────────────────────────────────────────

describe('summarizeMatchLog — multiLine header', () => {
  it('starts with rawInput and finalDecision', () => {
    const { multiLine } = summarizeMatchLog(makeEntry({ finalDecision: 'created' }));
    const header = multiLine.split('\n')[0];
    expect(header).toBe("'Chicken Breast' → created");
  });
});

// ── multiLine — stage lines ───────────────────────────────────────────────

describe('summarizeMatchLog — stage lines', () => {
  it('shows ✓ glyph for a passing stage', () => {
    const stages = [makeStage({ passed: true, bestScore: 1.0, gap: 0.0 })];
    const { multiLine } = summarizeMatchLog(makeEntry({ stages }));
    expect(multiLine).toContain('✓');
  });

  it('shows ✗ glyph for a failed stage with candidates', () => {
    const stages = [makeStage({ passed: false, bestScore: 0.9, gap: -0.1 })];
    const { multiLine } = summarizeMatchLog(makeEntry({ stages }));
    expect(multiLine).toContain('✗');
  });

  it('shows — glyph for a skipped stage', () => {
    const stages = [
      makeStage({ stage: 5, stageName: 'embedding', skipReason: 'no_items', bestScore: null }),
    ];
    const { multiLine } = summarizeMatchLog(makeEntry({ stages }));
    expect(multiLine).toContain('—');
    expect(multiLine).toContain('skip: no_items');
  });

  it('shows — glyph for embedding_error skip reason', () => {
    const stages = [
      makeStage({
        stage: 5,
        stageName: 'embedding',
        skipReason: 'embedding_error',
        bestScore: null,
      }),
    ];
    const { multiLine } = summarizeMatchLog(makeEntry({ stages }));
    expect(multiLine).toContain('skip: embedding_error');
  });

  it('shows — glyph for embedding_unavailable skip reason', () => {
    const stages = [
      makeStage({
        stage: 5,
        stageName: 'embedding',
        skipReason: 'embedding_unavailable',
        bestScore: null,
      }),
    ];
    const { multiLine } = summarizeMatchLog(makeEntry({ stages }));
    expect(multiLine).toContain('skip: embedding_unavailable');
  });

  it('shows — glyph and "no candidates" for null bestScore with no skipReason', () => {
    const stages = [makeStage({ passed: false, bestScore: null, skipReason: null })];
    const { multiLine } = summarizeMatchLog(makeEntry({ stages }));
    expect(multiLine).toContain('—');
    expect(multiLine).toContain('no candidates');
  });

  it('includes best candidate name from topCandidates', () => {
    const stages = [
      makeStage({
        passed: true,
        bestScore: 1.0,
        gap: 0.0,
        topCandidates: [{ itemId: 'item-1', itemName: 'Garlic', score: 1.0 }],
      }),
    ];
    const { multiLine } = summarizeMatchLog(makeEntry({ stages }));
    expect(multiLine).toContain('"Garlic"');
  });

  it('falls back to itemId when itemName is absent', () => {
    const stages = [
      makeStage({
        passed: true,
        bestScore: 1.0,
        gap: 0.0,
        topCandidates: [{ itemId: 'item-99', score: 1.0 }],
      }),
    ];
    const { multiLine } = summarizeMatchLog(makeEntry({ stages }));
    expect(multiLine).toContain('"item-99"');
  });

  it('includes threshold and gap with sign', () => {
    const stages = [
      makeStage({
        stage: 2,
        stageName: 'token_overlap',
        threshold: 0.8,
        passed: false,
        bestScore: 0.75,
        gap: -0.05,
        consideredCount: 4,
        topCandidates: [{ itemId: 'i', itemName: 'Garlic Cloves', score: 0.75 }],
      }),
    ];
    const { multiLine } = summarizeMatchLog(makeEntry({ stages }));
    expect(multiLine).toContain('thr 0.800');
    expect(multiLine).toContain('gap -0.050');
  });

  it('shows positive gap with + sign for passing stage', () => {
    const stages = [
      makeStage({
        stage: 4,
        stageName: 'string_similarity',
        threshold: 0.85,
        passed: true,
        bestScore: 0.9,
        gap: 0.05,
        consideredCount: 3,
        topCandidates: [{ itemId: 'i', itemName: 'Chicken', score: 0.9 }],
      }),
    ];
    const { multiLine } = summarizeMatchLog(makeEntry({ stages }));
    expect(multiLine).toContain('gap +0.050');
  });

  it('includes consideredCount and durationMs', () => {
    const stages = [makeStage({ consideredCount: 12, durationMs: 25, bestScore: 0.9, gap: -0.1 })];
    const { multiLine } = summarizeMatchLog(makeEntry({ stages }));
    expect(multiLine).toContain('12 considered');
    expect(multiLine).toContain('25ms');
  });

  it('includes stage name in each line', () => {
    const stages = [makeStage({ stage: 3, stageName: 'synonym', passed: false, bestScore: null })];
    const { multiLine } = summarizeMatchLog(makeEntry({ stages }));
    expect(multiLine).toContain('synonym');
  });
});

// ── multiLine — closing line ──────────────────────────────────────────────

describe('summarizeMatchLog — closing line', () => {
  it('ends with a total duration line', () => {
    const { multiLine } = summarizeMatchLog(makeEntry({ totalDurationMs: 88 }));
    const lastLine = multiLine.split('\n').at(-1) ?? '';
    expect(lastLine).toContain('88ms');
  });

  it('includes inputItemCount in the closing line', () => {
    const { multiLine } = summarizeMatchLog(makeEntry({ inputItemCount: 42 }));
    const lastLine = multiLine.split('\n').at(-1) ?? '';
    expect(lastLine).toContain('42');
  });
});

// ── multiLine — arbitration block ─────────────────────────────────────────

describe('summarizeMatchLog — arbitration block', () => {
  it('omits arbitration block when arbitration is null', () => {
    const { multiLine } = summarizeMatchLog(makeEntry({ arbitration: null }));
    expect(multiLine).not.toContain('AI arbitration');
  });

  it('includes arbitration outcome', () => {
    const entry = makeEntry({ arbitration: makeArbitration({ outcome: 'Chicken Breast' }) });
    const { multiLine } = summarizeMatchLog(entry);
    expect(multiLine).toContain('Chicken Breast');
    expect(multiLine).toContain('AI arbitration');
  });

  it('includes candidate and aisle counts', () => {
    const entry = makeEntry({ arbitration: makeArbitration({ candidatesIn: 3, aislesIn: 2 }) });
    const { multiLine } = summarizeMatchLog(entry);
    expect(multiLine).toContain('3 candidates');
    expect(multiLine).toContain('2 aisles');
  });

  it('uses singular forms for counts of 1', () => {
    const entry = makeEntry({ arbitration: makeArbitration({ candidatesIn: 1, aislesIn: 1 }) });
    const { multiLine } = summarizeMatchLog(entry);
    expect(multiLine).toContain('1 candidate,');
    expect(multiLine).toContain('1 aisle');
    expect(multiLine).not.toContain('1 candidates');
    expect(multiLine).not.toContain('1 aisles');
  });

  it('includes arbitration durationMs', () => {
    const entry = makeEntry({ arbitration: makeArbitration({ durationMs: 412 }) });
    const { multiLine } = summarizeMatchLog(entry);
    expect(multiLine).toContain('412ms');
  });

  it('shows reason line when reason is non-empty', () => {
    const entry = makeEntry({ arbitration: makeArbitration({ reason: 'near_miss' }) });
    const { multiLine } = summarizeMatchLog(entry);
    expect(multiLine).toContain('reason: near_miss');
  });

  it('omits reason line when reason is empty string (graceful empty-string handling)', () => {
    const entry = makeEntry({ arbitration: makeArbitration({ reason: '' }) });
    const { multiLine } = summarizeMatchLog(entry);
    expect(multiLine).not.toContain('reason:');
  });

  it('handles empty rawResponse gracefully (Phase 2 flag: CF not yet deployed)', () => {
    const entry = makeEntry({
      arbitration: makeArbitration({ rawResponse: '', prompt: '' }),
    });
    expect(() => summarizeMatchLog(entry)).not.toThrow();
    const { multiLine } = summarizeMatchLog(entry);
    expect(multiLine).toContain('AI arbitration');
  });

  it('handles empty outcome gracefully', () => {
    const entry = makeEntry({ arbitration: makeArbitration({ outcome: '' }) });
    const { multiLine } = summarizeMatchLog(entry);
    expect(multiLine).toContain('(no outcome)');
  });
});

// ── scenario: all stages fail (created) ──────────────────────────────────

describe('summarizeMatchLog — all-stages-fail (created)', () => {
  it('produces correct oneLine for all-fail scenario', () => {
    const stages = [1, 2, 3, 4, 5].map((n, i) =>
      makeStage({
        stage: n,
        stageName: ['exact_name', 'token_overlap', 'synonym', 'string_similarity', 'embedding'][i],
        threshold: [1.0, 0.8, 1.0, 0.85, 0.75][i],
        passed: false,
        bestScore: [0.9, 0.7, null, 0.8, 0.7][i],
        gap: [0.9 - 1.0, 0.7 - 0.8, null, 0.8 - 0.85, 0.7 - 0.75][i],
        consideredCount: 5,
      }),
    );
    const entry = makeEntry({ stages, finalDecision: 'created', totalDurationMs: 120 });
    const { oneLine } = summarizeMatchLog(entry);
    // stages 1, 2, 4, 5 have bestScore != null (failed with candidates) → 4 near-miss; stage 3 has bestScore null
    expect(oneLine).toBe("'Chicken Breast' → created (4 near-miss, 120ms)");
  });
});

// ── scenario: mid-stage match ─────────────────────────────────────────────

describe('summarizeMatchLog — mid-stage match', () => {
  it('correct near-miss count when match at stage 3', () => {
    const stages = [
      makeStage({ stage: 1, stageName: 'exact_name', passed: false, bestScore: 0.9, gap: -0.1 }),
      makeStage({
        stage: 2,
        stageName: 'token_overlap',
        threshold: 0.8,
        passed: false,
        bestScore: 0.75,
        gap: -0.05,
      }),
      makeStage({
        stage: 3,
        stageName: 'synonym',
        threshold: 1.0,
        passed: true,
        bestScore: 1.0,
        gap: 0.0,
      }),
    ];
    const entry = makeEntry({ stages, finalDecision: 'matched' });
    const { oneLine } = summarizeMatchLog(entry);
    expect(oneLine).toContain('2 near-miss');
  });
});

// ── scenario: embedding skipped ───────────────────────────────────────────

describe('summarizeMatchLog — embedding skipped', () => {
  it('embedding skipped with no_items does not count as near-miss', () => {
    const stages = [
      makeStage({ stage: 1, stageName: 'exact_name', passed: false, bestScore: null }),
      makeStage({ stage: 5, stageName: 'embedding', skipReason: 'no_items', bestScore: null }),
    ];
    const entry = makeEntry({ stages, finalDecision: 'created' });
    const { oneLine } = summarizeMatchLog(entry);
    expect(oneLine).toContain('0 near-miss');
  });
});

// ── scenario: AI arbitration path ────────────────────────────────────────

describe('summarizeMatchLog — AI arbitration path', () => {
  it('multiLine includes arbitration block', () => {
    const stages = [
      makeStage({ stage: 1, stageName: 'exact_name', passed: false, bestScore: 0.9, gap: -0.1 }),
    ];
    const entry = makeEntry({
      stages,
      finalDecision: 'ai_arbitrated',
      arbitration: makeArbitration(),
    });
    const { oneLine, multiLine } = summarizeMatchLog(entry);
    expect(oneLine).toContain('ai_arbitrated');
    expect(multiLine).toContain('AI arbitration');
  });
});

// ── scenario: surfaced_candidates ────────────────────────────────────────

describe('summarizeMatchLog — surfaced_candidates path', () => {
  it('oneLine shows surfaced_candidates decision', () => {
    const stages = [
      makeStage({ stage: 1, stageName: 'exact_name', passed: false, bestScore: 0.9, gap: -0.1 }),
    ];
    const entry = makeEntry({
      stages,
      finalDecision: 'surfaced_candidates',
      surfacedCandidates: [{ itemId: 'i1', itemName: 'Garlic', confidence: 0.9, stage: 1 }],
    });
    const { oneLine } = summarizeMatchLog(entry);
    expect(oneLine).toContain('surfaced_candidates');
    expect(oneLine).toContain('1 near-miss');
  });
});

// ── scenario: force-create (inputItemCount = 0) ──────────────────────────

describe('summarizeMatchLog — force-create path', () => {
  it('handles empty store (inputItemCount = 0)', () => {
    const entry = makeEntry({
      stages: [],
      finalDecision: 'created',
      inputItemCount: 0,
      totalDurationMs: 5,
    });
    const { oneLine, multiLine } = summarizeMatchLog(entry);
    expect(oneLine).toBe("'Chicken Breast' → created (0 near-miss, 5ms)");
    expect(multiLine).toContain('0 items in store');
  });
});
