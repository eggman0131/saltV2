import {
  subscribeProductForms,
  upsertProductForm,
  deleteProductForm as deleteProductFormDoc,
} from '@salt/firebase-sync';
import { createObservabilityErrorReportingAdapter } from '@salt/observability';
import { createProductForm, updateProductForm } from '@salt/domain';
import type { ProductForm, CreateProductFormInput, UpdateProductFormInput } from '@salt/domain';
import { type DomainError, type Result } from '@salt/shared-types';
import { writable, get } from 'svelte/store';
import type { Readable } from 'svelte/store';
import { reportIfFailed, reportSubscriptionError } from './errorReporting.js';

// ─── Reactive stores ────────────────────────────────────────────────────────────

const _productForms = writable<readonly ProductForm[]>([]);
export const productForms: Readable<readonly ProductForm[]> = _productForms;

const _isLoadingProductForms = writable(false);
export const isLoadingProductForms: Readable<boolean> = _isLoadingProductForms;

// ─── Error reporting ────────────────────────────────────────────────────────────

let _errorReporter: ReturnType<typeof createObservabilityErrorReportingAdapter> | null = null;
function getErrorReporter() {
  if (!_errorReporter) _errorReporter = createObservabilityErrorReportingAdapter();
  return _errorReporter;
}

// ─── Init / cleanup ─────────────────────────────────────────────────────────────

export function initProductFormSync(): () => void {
  _isLoadingProductForms.set(true);
  const errors = getErrorReporter();

  return subscribeProductForms(
    (items) => {
      _productForms.set(items);
      _isLoadingProductForms.set(false);
    },
    (err, rawError) => reportSubscriptionError(errors, err, rawError),
  );
}

// ─── Snapshot ────────────────────────────────────────────────────────────────────

export function getProductFormsSnapshot(): readonly ProductForm[] {
  return get(_productForms);
}

// ─── Commands ─────────────────────────────────────────────────────────────────────

export async function addProductForm(
  input: CreateProductFormInput,
): Promise<Result<ProductForm, DomainError>> {
  const result = createProductForm(input, { newProductFormId: () => crypto.randomUUID() });
  if (result.kind === 'ok') await upsertProductForm(result.value);
  return result;
}

export async function editProductForm(
  form: ProductForm,
  input: UpdateProductFormInput,
): Promise<Result<ProductForm, DomainError>> {
  const result = updateProductForm(form, input);
  if (result.kind === 'ok') await upsertProductForm(result.value);
  return result;
}

export async function deleteProductForm(id: string): Promise<Result<void, DomainError>> {
  return reportIfFailed(getErrorReporter(), await deleteProductFormDoc(id));
}

// ─── Test helpers ────────────────────────────────────────────────────────────────

export function __resetProductFormServiceForTest(): void {
  _productForms.set([]);
  _isLoadingProductForms.set(false);
  _errorReporter = null;
}
