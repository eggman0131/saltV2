import { describe, it, expect } from 'vitest';
import { AppSettingsSchema, AI_MODEL_DEFAULTS } from '@salt/domain/schemas';

// Admin-managed AI model settings (Phase 1). The per-role defaults are the
// load-bearing safety property: a missing, empty, or partial doc MUST resolve
// every role to today's exact production literal, so deleting/corrupting the doc
// leaves AI fully working.
describe('AppSettingsSchema', () => {
  it('defaults every role to today exact production literal for an empty doc', () => {
    expect(AppSettingsSchema.parse({})).toEqual({
      fast: 'gemini-flash-latest',
      pro: 'gemini-pro-latest',
      embedding: 'gemini-embedding-001',
      image: 'gemini-2.5-flash-image',
      schemaVersion: 1,
    });
  });

  it('AI_MODEL_DEFAULTS match the schema defaults', () => {
    const parsed = AppSettingsSchema.parse({});
    expect(parsed.fast).toBe(AI_MODEL_DEFAULTS.fast);
    expect(parsed.pro).toBe(AI_MODEL_DEFAULTS.pro);
    expect(parsed.embedding).toBe(AI_MODEL_DEFAULTS.embedding);
    expect(parsed.image).toBe(AI_MODEL_DEFAULTS.image);
  });

  it('fills only the unset roles with defaults (partial doc)', () => {
    const parsed = AppSettingsSchema.parse({ fast: 'custom-fast-model' });
    expect(parsed.fast).toBe('custom-fast-model');
    expect(parsed.pro).toBe(AI_MODEL_DEFAULTS.pro);
    expect(parsed.embedding).toBe(AI_MODEL_DEFAULTS.embedding);
    expect(parsed.image).toBe(AI_MODEL_DEFAULTS.image);
  });

  it('preserves explicit per-role overrides and audit metadata', () => {
    const parsed = AppSettingsSchema.parse({
      fast: 'a',
      pro: 'b',
      embedding: 'c',
      image: 'd',
      updatedAt: 1234,
      updatedBy: 'admin@example.com',
    });
    expect(parsed).toEqual({
      fast: 'a',
      pro: 'b',
      embedding: 'c',
      image: 'd',
      schemaVersion: 1,
      updatedAt: 1234,
      updatedBy: 'admin@example.com',
    });
  });

  it('rejects an empty-string model name (falls back via safeParse failure)', () => {
    expect(AppSettingsSchema.safeParse({ fast: '' }).success).toBe(false);
  });

  it('rejects a non-string model name', () => {
    expect(AppSettingsSchema.safeParse({ fast: 123 }).success).toBe(false);
  });

  // ─── Phase 2: optional per-flow overrides ─────────────────────────────────
  it('a Phase 1 doc with no perFlow parses and yields no overrides (back-compat)', () => {
    const parsed = AppSettingsSchema.parse({
      fast: 'a',
      pro: 'b',
      embedding: 'c',
      image: 'd',
    });
    // Absent field stays absent — "no overrides", never an empty object.
    expect(parsed.perFlow).toBeUndefined();
  });

  it('preserves an explicit perFlow override map', () => {
    const parsed = AppSettingsSchema.parse({
      fast: 'role-fast',
      perFlow: { authorRecipe: 'flow-specific', chefChat: 'flow-pro' },
    });
    expect(parsed.perFlow).toEqual({ authorRecipe: 'flow-specific', chefChat: 'flow-pro' });
  });

  it('accepts an empty perFlow map (degenerate but valid)', () => {
    const parsed = AppSettingsSchema.parse({ perFlow: {} });
    expect(parsed.perFlow).toEqual({});
  });

  it('rejects an empty-string override value', () => {
    expect(AppSettingsSchema.safeParse({ perFlow: { authorRecipe: '' } }).success).toBe(false);
  });

  it('rejects a non-string override value', () => {
    expect(AppSettingsSchema.safeParse({ perFlow: { authorRecipe: 123 } }).success).toBe(false);
  });
});
