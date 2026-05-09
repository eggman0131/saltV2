import type { Locator, Page } from '@playwright/test';

export interface AislesPageLocators {
  readonly heading: Locator;
  readonly addButton: Locator;
  readonly addDialog: Locator;
  readonly addTextarea: Locator;
  readonly addSubmit: Locator;
  readonly bulkDeleteButton: Locator;
  readonly bulkDeleteDialog: Locator;
  readonly bulkDeleteConfirm: Locator;
  row(id: string): Locator;
  rowItem(id: string): Locator;
  rowCheckbox(id: string): Locator;
  dragHandle(id: string): Locator;
}

export function aislesPage(page: Page): AislesPageLocators {
  return {
    heading: page.getByRole('heading', { name: /manage aisles/i }),
    addButton: page.getByTestId('aisle-add-button'),
    addDialog: page.getByTestId('aisle-add-dialog'),
    addTextarea: page.getByTestId('aisle-add-textarea'),
    addSubmit: page.getByTestId('aisle-add-submit'),
    bulkDeleteButton: page.getByTestId('bulk-delete-button'),
    bulkDeleteDialog: page.getByTestId('bulk-delete-dialog'),
    bulkDeleteConfirm: page.getByTestId('bulk-delete-confirm'),
    row: (id) => page.getByTestId(`aisle-row-${id}`),
    rowItem: (id) => page.locator(`li:has([data-testid="aisle-row-${id}"])`),
    rowCheckbox: (id) => page.getByTestId(`aisle-row-checkbox-${id}`),
    dragHandle: (id) => page.getByTestId(`aisle-drag-handle-${id}`),
  };
}

export interface CanonCreatePageLocators {
  readonly comboboxInput: Locator;
  readonly pendingIndicator: Locator;
}

export function canonCreatePage(page: Page): CanonCreatePageLocators {
  return {
    comboboxInput: page.getByRole('combobox'),
    pendingIndicator: page.getByTestId('canon-create-pending'),
  };
}

export interface CanonDetailPageLocators {
  readonly nameEditButton: Locator;
  readonly nameInput: Locator;
  readonly synonymsInput: Locator;
  readonly aisleTrigger: Locator;
  readonly deleteButton: Locator;
  readonly deleteDialog: Locator;
  readonly deleteConfirm: Locator;
}

export function canonDetailPage(page: Page): CanonDetailPageLocators {
  return {
    nameEditButton: page.getByRole('button', { name: /edit name/i }),
    nameInput: page.getByTestId('canon-detail-name-input'),
    synonymsInput: page.getByTestId('canon-detail-synonyms-input'),
    aisleTrigger: page.getByTestId('canon-detail-aisle-select').getByRole('button'),
    deleteButton: page.getByTestId('canon-detail-delete-button'),
    deleteDialog: page.getByTestId('canon-detail-delete-dialog'),
    deleteConfirm: page.getByTestId('canon-detail-delete-confirm'),
  };
}
