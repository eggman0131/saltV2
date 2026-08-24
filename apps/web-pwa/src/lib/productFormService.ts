import {
  subscribeProductForms,
  upsertProductForm,
  deleteProductForm as deleteProductFormDoc,
  callRegenerateProductFormIcon,
} from '@salt/firebase-sync';
import { createObservabilityErrorReportingAdapter } from '@salt/observability';
import {
  createProductForm,
  updateProductForm,
  confirmProductForm as confirmProductFormCmd,
  setProductFormThumbnail,
  CANON_ICON_HIDDEN,
} from '@salt/domain';
import type { ProductForm, CreateProductFormInput, UpdateProductFormInput } from '@salt/domain';
import { type DomainError, type ReadResult, type Result } from '@salt/shared-types';
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

// The write half of every product-form edit (#931), the twin of canonService's
// `commitCanonItemUpdate`: the persistence outcome comes back so a command that
// produced a valid form still answers `err` when the document never landed, and
// the §7.6 gate sees it once rather than at four call sites.
async function commitProductForm(form: ProductForm): Promise<ReadResult<void, DomainError>> {
  return reportIfFailed(getErrorReporter(), await upsertProductForm(form));
}

export async function addProductForm(
  input: CreateProductFormInput,
): Promise<Result<ProductForm, DomainError>> {
  const result = createProductForm(input, { newProductFormId: () => crypto.randomUUID() });
  if (result.kind !== 'ok') return result;
  const written = await commitProductForm(result.value);
  return written.kind === 'err' ? written : result;
}

export async function editProductForm(
  form: ProductForm,
  input: UpdateProductFormInput,
): Promise<Result<ProductForm, DomainError>> {
  const result = updateProductForm(form, input);
  if (result.kind !== 'ok') return result;
  const written = await commitProductForm(result.value);
  return written.kind === 'err' ? written : result;
}

// Confirm an AI-seeded (pending) product form (issue #500, Phase 3). Applies the
// admin's reviewed edits to the parent/yield AND clears the needs-review flag in
// a single write — mirrors canonService.approveCanonItemWithOverrides. A pending
// form already resolves recipes live; confirming records the review, it does not
// unlock use.
export async function confirmProductForm(
  form: ProductForm,
  input: UpdateProductFormInput,
): Promise<Result<ProductForm, DomainError>> {
  const updated = updateProductForm(form, input);
  if (updated.kind !== 'ok') return updated;
  const confirmed = confirmProductFormCmd(updated.value);
  if (confirmed.kind !== 'ok') return confirmed;
  const written = await commitProductForm(confirmed.value);
  return written.kind === 'err' ? written : confirmed;
}

export async function deleteProductForm(id: string): Promise<Result<void, DomainError>> {
  return reportIfFailed(getErrorReporter(), await deleteProductFormDoc(id));
}

// ─── Icon (Tier-1 pictogram) escape hatch (issue #871) ──────────────────────────
//
// The exact twin of canonService's trio: regenerate and unhide both clear
// `thumbnail` through the auth'd callable (which is what re-fires the trigger),
// while hide is a plain client write of the shared `CANON_ICON_HIDDEN` sentinel —
// it needs no server authority.

/**
 * Regenerate a product form's icon: clears `thumbnail` server-side (auth'd
 * callable), re-firing the trigger so the icon branch regenerates. An optional
 * `hint` is a one-shot additive steer for the next generation.
 */
export async function regenerateProductFormIcon(
  id: string,
  hint?: string,
): Promise<Result<void, DomainError>> {
  return reportIfFailed(getErrorReporter(), await callRegenerateProductFormIcon(id, hint));
}

/** Hide a product form's icon: sets `thumbnail` to the "hidden" sentinel so the
 *  trigger never regenerates it and the UI shows the bare tile. */
export async function hideProductFormIcon(
  form: ProductForm,
): Promise<Result<ProductForm, DomainError>> {
  const result = setProductFormThumbnail(form, CANON_ICON_HIDDEN);
  if (result.kind !== 'ok') return result;
  const written = await commitProductForm(result.value);
  return written.kind === 'err' ? written : result;
}

/** Un-hide a product form's icon: clears the "hidden" sentinel (→ null) via the
 *  regenerate callable, which re-triggers generation. */
export async function unhideProductFormIcon(id: string): Promise<Result<void, DomainError>> {
  return reportIfFailed(getErrorReporter(), await callRegenerateProductFormIcon(id));
}

// ─── Test helpers ────────────────────────────────────────────────────────────────

export function __resetProductFormServiceForTest(): void {
  _productForms.set([]);
  _isLoadingProductForms.set(false);
  _errorReporter = null;
}
