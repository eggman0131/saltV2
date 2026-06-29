import { describe, it, expect, vi, beforeEach } from 'vitest';

// The add-equipment action (issue #361) hands the SAME browser-minted
// `traceparent` to both equipment callables so their CF flows share one trace.
// firebase-sync only forwards the string on the payload (Rule 4 — no
// observability import); the field is optional, so old callers omit it entirely
// (NOT `traceparent: undefined`, which would widen the wire shape).

const callableMock = vi.fn(async () => ({ data: { candidates: [] } }));
const httpsCallable = vi.fn(() => callableMock);

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable,
}));

const { callIdentifyEquipment, callPopulateEquipmentEntry } =
  await import('../src/equipmentCallables.js');

const TRACEPARENT = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

beforeEach(() => {
  callableMock.mockClear();
  httpsCallable.mockClear();
});

describe('callIdentifyEquipment — traceparent forwarding', () => {
  it('forwards the traceparent on the payload when supplied', async () => {
    callableMock.mockResolvedValueOnce({ data: { candidates: [] } });
    await callIdentifyEquipment('KitchenAid', TRACEPARENT);
    expect(callableMock).toHaveBeenCalledWith({ rawName: 'KitchenAid', traceparent: TRACEPARENT });
  });

  it('omits the field entirely when no traceparent is supplied', async () => {
    callableMock.mockResolvedValueOnce({ data: { candidates: [] } });
    await callIdentifyEquipment('KitchenAid');
    expect(callableMock).toHaveBeenCalledWith({ rawName: 'KitchenAid' });
    expect(callableMock.mock.calls[0]![0]).not.toHaveProperty('traceparent');
  });
});

describe('callPopulateEquipmentEntry — traceparent forwarding', () => {
  it('forwards the SAME traceparent on the payload when supplied', async () => {
    callableMock.mockResolvedValueOnce({ data: { name: 'Stand mixer', accessories: [] } });
    await callPopulateEquipmentEntry('KitchenAid Artisan', TRACEPARENT);
    expect(callableMock).toHaveBeenCalledWith({
      confirmedName: 'KitchenAid Artisan',
      traceparent: TRACEPARENT,
    });
  });

  it('omits the field entirely when no traceparent is supplied', async () => {
    callableMock.mockResolvedValueOnce({ data: { name: 'Stand mixer', accessories: [] } });
    await callPopulateEquipmentEntry('KitchenAid Artisan');
    expect(callableMock).toHaveBeenCalledWith({ confirmedName: 'KitchenAid Artisan' });
    expect(callableMock.mock.calls[0]![0]).not.toHaveProperty('traceparent');
  });
});
