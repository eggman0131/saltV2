export interface ShoppingList {
  readonly id: string;
  readonly name: string;
  readonly schemaVersion: 1;
  readonly createdAt: string; // ISO-8601
  readonly updatedAt: string; // ISO-8601
}
