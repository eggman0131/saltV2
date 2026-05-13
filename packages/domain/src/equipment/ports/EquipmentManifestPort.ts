import type { ReadResult } from '@salt/shared-types';
import type { DomainError } from '@salt/shared-types';
import type { EquipmentManifest } from '../entities/EquipmentManifest.js';

export interface EquipmentManifestPort {
  load(): Promise<ReadResult<EquipmentManifest | null, DomainError>>;
  save(manifest: EquipmentManifest): Promise<ReadResult<void, DomainError>>;
}
