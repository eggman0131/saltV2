import { describe, it, expect } from 'vitest';
import { DevSettingsSchema } from '@salt/domain/schemas';

// Per-environment dev settings (issue #238). The kill-switch defaults matter:
// an empty/missing doc must read as ENABLED so existing environments and the CF
// trigger keep generating by default.
describe('DevSettingsSchema', () => {
  it('defaults both kill-switches to enabled with schemaVersion 1 for an empty doc', () => {
    expect(DevSettingsSchema.parse({})).toEqual({
      canonIconGenerationEnabled: true,
      recipeImageGenerationEnabled: true,
      schemaVersion: 1,
    });
  });

  it('preserves an explicit disabled canon-icon flag', () => {
    expect(DevSettingsSchema.parse({ canonIconGenerationEnabled: false })).toEqual({
      canonIconGenerationEnabled: false,
      recipeImageGenerationEnabled: true,
      schemaVersion: 1,
    });
  });

  it('preserves an explicit disabled recipe-image flag independently of the canon switch', () => {
    expect(DevSettingsSchema.parse({ recipeImageGenerationEnabled: false })).toEqual({
      canonIconGenerationEnabled: true,
      recipeImageGenerationEnabled: false,
      schemaVersion: 1,
    });
  });

  // Back-compat: a doc written before recipeImageGenerationEnabled existed has no
  // such field; it MUST still parse and default the new switch to enabled.
  it('a doc without recipeImageGenerationEnabled parses and defaults it to enabled', () => {
    expect(DevSettingsSchema.parse({ canonIconGenerationEnabled: false })).toMatchObject({
      recipeImageGenerationEnabled: true,
    });
  });

  it('rejects a non-boolean flag', () => {
    expect(DevSettingsSchema.safeParse({ canonIconGenerationEnabled: 'yes' }).success).toBe(false);
    expect(DevSettingsSchema.safeParse({ recipeImageGenerationEnabled: 'yes' }).success).toBe(
      false,
    );
  });
});
