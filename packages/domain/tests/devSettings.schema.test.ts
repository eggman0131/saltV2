import { describe, it, expect } from 'vitest';
import { DevSettingsSchema } from '@salt/domain/schemas';

// Per-environment dev settings (issue #238). The kill-switch defaults matter:
// an empty/missing doc must read as ENABLED so existing environments and the CF
// trigger keep generating by default.
describe('DevSettingsSchema', () => {
  it('defaults to enabled with schemaVersion 1 for an empty doc', () => {
    expect(DevSettingsSchema.parse({})).toEqual({
      canonIconGenerationEnabled: true,
      schemaVersion: 1,
    });
  });

  it('preserves an explicit disabled flag', () => {
    expect(DevSettingsSchema.parse({ canonIconGenerationEnabled: false })).toEqual({
      canonIconGenerationEnabled: false,
      schemaVersion: 1,
    });
  });

  it('rejects a non-boolean flag', () => {
    expect(DevSettingsSchema.safeParse({ canonIconGenerationEnabled: 'yes' }).success).toBe(false);
  });
});
