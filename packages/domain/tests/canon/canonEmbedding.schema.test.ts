import { describe, it, expect } from 'vitest';
import { CanonEmbeddingSchema } from '@salt/domain/schemas';

// Server-only companion doc for a canon item's name vector (issue #410). Keyed by
// canon id in canonEmbeddings/{id}; read only by the CF match adapter.
describe('CanonEmbeddingSchema', () => {
  it('parses a doc with just an embedding array', () => {
    const result = CanonEmbeddingSchema.safeParse({ embedding: [0.1, 0.2, 0.3] });
    expect(result.success).toBe(true);
    expect(result.success && result.data.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(result.success && result.data.updatedAt).toBeUndefined();
  });

  it('carries the optional updatedAt watermark through when present', () => {
    const result = CanonEmbeddingSchema.safeParse({
      embedding: [1, 2],
      updatedAt: '2026-07-03T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.updatedAt).toBe('2026-07-03T00:00:00.000Z');
  });

  it('rejects a missing embedding (the field is required in this collection)', () => {
    expect(CanonEmbeddingSchema.safeParse({ updatedAt: 'x' }).success).toBe(false);
  });

  it('rejects a null embedding — an un-embedded item has no companion doc, not a null one', () => {
    expect(CanonEmbeddingSchema.safeParse({ embedding: null }).success).toBe(false);
  });

  it('rejects a non-numeric embedding', () => {
    expect(CanonEmbeddingSchema.safeParse({ embedding: ['a', 'b'] }).success).toBe(false);
  });
});
