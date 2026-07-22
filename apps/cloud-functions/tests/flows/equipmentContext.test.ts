import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWarn = vi.fn();
vi.mock('firebase-functions', () => ({
  logger: { warn: mockWarn, info: vi.fn(), error: vi.fn() },
}));

const {
  renderEquipmentManifest,
  readEquipmentContext,
  equipmentSectionForChef,
  equipmentSectionForLibrarian,
} = await import('../../src/flows/equipmentContext.js');

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function accessory(name: string, owned: boolean) {
  return { id: `acc-${name}`, name, owned, included: false };
}

function item(
  name: string,
  opts: { accessories?: ReturnType<typeof accessory>[]; rules?: string[] } = {},
) {
  return {
    id: `eq-${name}`,
    schemaVersion: 1 as const,
    name,
    accessories: opts.accessories ?? [],
    rules: opts.rules ?? [],
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

function manifest(items: ReturnType<typeof item>[]) {
  return { schemaVersion: 1 as const, updatedAt: '2026-07-01T00:00:00.000Z', items };
}

/** A Firestore stub whose equipmentManifest/current get() resolves to `snap`. */
function dbReturning(snap: unknown) {
  return { collection: () => ({ doc: () => ({ get: () => Promise.resolve(snap) }) }) } as never;
}

// ─── rendering ────────────────────────────────────────────────────────────────

describe('renderEquipmentManifest', () => {
  it('renders each item by name', () => {
    const out = renderEquipmentManifest([
      item('Sage the Smart Oven Pizzaiolo SPZ820'),
      item('Anova Precision Oven'),
    ]);
    expect(out).toContain('- Sage the Smart Oven Pizzaiolo SPZ820');
    expect(out).toContain('- Anova Precision Oven');
  });

  it('renders owned accessories as owned', () => {
    const out = renderEquipmentManifest([
      item('Magimix Cook Expert', {
        accessories: [accessory('4 mm slicing disc', true), accessory('Steam basket', true)],
      }),
    ]);
    expect(out).toContain('accessories owned: 4 mm slicing disc, Steam basket');
    expect(out).not.toContain('NOT owned');
  });

  it('renders unowned accessories as explicitly unavailable rather than dropping them', () => {
    const out = renderEquipmentManifest([
      item('Magimix Cook Expert', {
        accessories: [
          accessory('4 mm slicing disc', true),
          accessory('XL Steamer Attachment', false),
        ],
      }),
    ]);
    // The unowned one must survive into the prompt — the whole point is that the
    // chef can say "you don't have that" instead of suggesting it blindly.
    expect(out).toContain('XL Steamer Attachment');
    expect(out).toContain('accessories NOT owned');
    // …and it must not be confused with the owned list.
    expect(out).toContain('accessories owned: 4 mm slicing disc');
    expect(out).not.toContain('accessories owned: 4 mm slicing disc, XL Steamer Attachment');
  });

  it('surfaces the household rules override', () => {
    const out = renderEquipmentManifest([
      item('Kuhn Rikon Duromatic Inox 6L / 24cm', {
        rules: ['Never fill past two-thirds', 'Always release pressure under cold water'],
      }),
    ]);
    expect(out).toContain('household rules');
    expect(out).toContain('override your own product knowledge');
    expect(out).toContain('Never fill past two-thirds');
    expect(out).toContain('Always release pressure under cold water');
  });

  it('omits the accessory and rules lines entirely when there are none', () => {
    const out = renderEquipmentManifest([item('Cast iron skillet')]);
    expect(out).toBe('- Cast iron skillet');
  });

  it('degrades to an empty string for an empty manifest', () => {
    expect(renderEquipmentManifest([])).toBe('');
  });
});

// ─── reading ──────────────────────────────────────────────────────────────────

describe('readEquipmentContext', () => {
  it('reads, validates, and renders the manifest', async () => {
    const db = dbReturning({
      exists: true,
      data: () =>
        manifest([
          item('Sage the Smart Oven Pizzaiolo SPZ820', {
            accessories: [accessory('Pizza stone', true), accessory('Crisper plate', false)],
            rules: ['Preheat for a full 20 minutes'],
          }),
        ]),
    });

    const out = await readEquipmentContext(db, 'chefChat');
    expect(out).toContain('- Sage the Smart Oven Pizzaiolo SPZ820');
    expect(out).toContain('accessories owned: Pizza stone');
    expect(out).toContain('accessories NOT owned');
    expect(out).toContain('Crisper plate');
    expect(out).toContain('Preheat for a full 20 minutes');
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('degrades to an empty string when the manifest doc does not exist', async () => {
    expect(await readEquipmentContext(dbReturning({ exists: false }), 'chefChat')).toBe('');
  });

  it('degrades to an empty string when the manifest has no items', async () => {
    const db = dbReturning({ exists: true, data: () => manifest([]) });
    expect(await readEquipmentContext(db, 'chefChat')).toBe('');
  });

  it('logs and degrades when the manifest fails validation', async () => {
    const db = dbReturning({ exists: true, data: () => ({ schemaVersion: 99 }) });
    expect(await readEquipmentContext(db, 'authorRecipe')).toBe('');
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('authorRecipe'));
  });

  it('logs and degrades when the read throws — never propagates the failure', async () => {
    const db = {
      collection: () => ({
        doc: () => ({ get: () => Promise.reject(new Error('firestore down')) }),
      }),
    } as never;
    expect(await readEquipmentContext(db, 'chefChat')).toBe('');
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('failed to read equipmentManifest'),
      expect.anything(),
    );
  });
});

// ─── framings ─────────────────────────────────────────────────────────────────

describe('equipment prompt framings', () => {
  const context = '- Sage the Smart Oven Pizzaiolo SPZ820';

  it('gives the chef sweep-then-detail, proportionality, and the no-shoehorn escape hatch', () => {
    const section = equipmentSectionForChef(context);
    expect(section).toContain(context);
    expect(section).toContain('PROPORTIONALITY IS A RULE');
    expect(section).toContain('MOST VIABLE');
    expect(section).toContain('washing-up');
    expect(section).toContain('NOT owned are unavailable');
    expect(section).toContain('OVERRIDE your general product knowledge');
    // Still free to answer without any appliance at all.
    expect(section).toContain('need no special kit');
    // The old opt-out must not come back.
    expect(section).not.toContain('never feel obliged');
  });

  it('gives the librarian preservation-only framing, never licence to pick equipment', () => {
    const section = equipmentSectionForLibrarian(context);
    expect(section).toContain(context);
    expect(section).toContain('RECOGNITION ONLY');
    expect(section).toContain('PRESERVE');
    expect(section).toContain('NEVER generalise a named appliance');
    expect(section).toContain('NEVER introduce, substitute, or upgrade equipment');
    expect(section).toContain('NOT a menu');
  });

  it('omits both sections entirely when there is no equipment context', () => {
    expect(equipmentSectionForChef('')).toBe('');
    expect(equipmentSectionForLibrarian('')).toBe('');
  });
});
