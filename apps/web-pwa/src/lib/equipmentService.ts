import {
  subscribeEquipmentManifest,
  saveEquipmentManifest,
  callIdentifyEquipment,
  callPopulateEquipmentEntry,
} from '@salt/firebase-sync';
import type { IdentifyEquipmentResult, PopulateEquipmentEntryResult } from '@salt/firebase-sync';
import {
  addEquipment,
  removeEquipment,
  renameEquipment,
  addAccessory,
  removeAccessory,
  setAccessoryOwned,
  addRule,
  removeRule,
  editRule,
} from '@salt/domain';
import type { EquipmentManifest } from '@salt/domain';
import { failure, type DomainError, type ReadResult } from '@salt/shared-types';
import { writable, get } from 'svelte/store';
import type { Readable } from 'svelte/store';

export type { IdentifyEquipmentResult, PopulateEquipmentEntryResult };

// ─── Reactive stores ─────────────────────────────────────────────────────────

const _equipment = writable<EquipmentManifest | null>(null);
export const equipment: Readable<EquipmentManifest | null> = _equipment;

const _isLoadingEquipment = writable(true);
export const isLoadingEquipment: Readable<boolean> = _isLoadingEquipment;

// ─── ID generator ─────────────────────────────────────────────────────────────

const ids = {
  newEquipmentId: () => crypto.randomUUID(),
  newAccessoryId: () => crypto.randomUUID(),
};

// ─── Empty manifest ───────────────────────────────────────────────────────────

function emptyManifest(): EquipmentManifest {
  return { schemaVersion: 1, updatedAt: new Date().toISOString(), items: [] };
}

// ─── Init / cleanup ───────────────────────────────────────────────────────────

export function initEquipmentSync(): () => void {
  _isLoadingEquipment.set(true);

  const unsub = subscribeEquipmentManifest(
    (manifest) => {
      _equipment.set(manifest);
      _isLoadingEquipment.set(false);
    },
    (_err) => {
      _isLoadingEquipment.set(false);
    },
  );

  return unsub;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function currentManifest(): EquipmentManifest {
  return get(_equipment) ?? emptyManifest();
}

async function applyAndSave(
  result: ReadResult<EquipmentManifest, DomainError>,
): Promise<ReadResult<EquipmentManifest, DomainError>> {
  if (result.kind !== 'ok') return result;
  _equipment.set(result.value);
  await saveEquipmentManifest(result.value);
  return result;
}

// ─── Equipment commands ───────────────────────────────────────────────────────

export async function addEquipmentItem(
  name: string,
): Promise<ReadResult<EquipmentManifest, DomainError>> {
  const result = addEquipment(currentManifest(), { name, now: new Date().toISOString() }, ids);
  return applyAndSave(result);
}

export async function removeEquipmentItem(
  id: string,
): Promise<ReadResult<EquipmentManifest, DomainError>> {
  const result = removeEquipment(currentManifest(), { id });
  return applyAndSave(result);
}

export async function renameEquipmentItem(
  id: string,
  name: string,
): Promise<ReadResult<EquipmentManifest, DomainError>> {
  const result = renameEquipment(currentManifest(), { id, name, now: new Date().toISOString() });
  return applyAndSave(result);
}

// ─── Accessory commands ───────────────────────────────────────────────────────

export async function addEquipmentAccessory(
  equipmentId: string,
  name: string,
  owned: boolean,
  included: boolean,
): Promise<ReadResult<EquipmentManifest, DomainError>> {
  const result = addAccessory(
    currentManifest(),
    { equipmentId, name, owned, included, now: new Date().toISOString() },
    ids,
  );
  return applyAndSave(result);
}

export async function removeEquipmentAccessory(
  equipmentId: string,
  accessoryId: string,
): Promise<ReadResult<EquipmentManifest, DomainError>> {
  const result = removeAccessory(currentManifest(), {
    equipmentId,
    accessoryId,
    now: new Date().toISOString(),
  });
  return applyAndSave(result);
}

export async function toggleEquipmentAccessoryOwned(
  equipmentId: string,
  accessoryId: string,
  owned: boolean,
): Promise<ReadResult<EquipmentManifest, DomainError>> {
  const result = setAccessoryOwned(currentManifest(), {
    equipmentId,
    accessoryId,
    owned,
    now: new Date().toISOString(),
  });
  return applyAndSave(result);
}

// ─── Rule commands ────────────────────────────────────────────────────────────

export async function addEquipmentRule(
  equipmentId: string,
  rule: string,
): Promise<ReadResult<EquipmentManifest, DomainError>> {
  const result = addRule(currentManifest(), {
    equipmentId,
    rule,
    now: new Date().toISOString(),
  });
  return applyAndSave(result);
}

export async function removeEquipmentRule(
  equipmentId: string,
  ruleIndex: number,
): Promise<ReadResult<EquipmentManifest, DomainError>> {
  const result = removeRule(currentManifest(), {
    equipmentId,
    ruleIndex,
    now: new Date().toISOString(),
  });
  return applyAndSave(result);
}

export async function editEquipmentRule(
  equipmentId: string,
  ruleIndex: number,
  rule: string,
): Promise<ReadResult<EquipmentManifest, DomainError>> {
  const result = editRule(currentManifest(), {
    equipmentId,
    ruleIndex,
    rule,
    now: new Date().toISOString(),
  });
  return applyAndSave(result);
}

// ─── AI capture helpers ───────────────────────────────────────────────────────

export { callIdentifyEquipment, callPopulateEquipmentEntry };

// ─── Test helpers ─────────────────────────────────────────────────────────────

export function __resetEquipmentServiceForTest(): void {
  _equipment.set(null);
  _isLoadingEquipment.set(true);
}

// ─── Snapshot (used by e2e bridge) ────────────────────────────────────────────

export function getEquipmentSnapshot(): EquipmentManifest | null {
  return get(_equipment);
}

export async function seedEquipmentManifest(manifest: EquipmentManifest): Promise<void> {
  _equipment.set(manifest);
  await saveEquipmentManifest(manifest);
}
