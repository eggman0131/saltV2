export interface Accessory {
  readonly id: string;
  readonly name: string;
  readonly owned: boolean;
  readonly included: boolean;
}

export interface EquipmentItem {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly name: string;
  readonly accessories: readonly Accessory[];
  readonly rules: readonly string[];
  readonly updatedAt: string; // ISO-8601, stamped by domain commands on mutation
}
