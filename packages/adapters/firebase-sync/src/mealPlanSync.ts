import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { MealPlanConfig, MealPlanTemplate, MealPlanWeek } from '@salt/domain';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { success, failure } from '@salt/shared-types';
import {
  MealPlanConfigSchema,
  MealPlanTemplateSchema,
  MealPlanWeekSchema,
} from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';
import { subscribeDocument } from './subscribeDocument.js';

// Meal planning sync (issue #169). Three Firestore docs, all single-document
// reads: config + template are singletons, a week is one dated doc. A corrupt
// doc surfaces a Failure via onError (single-doc read contract) rather than
// throwing. See docs/meal-planning.md.

const CONFIG_COLLECTION = 'mealPlanConfig';
const TEMPLATE_COLLECTION = 'mealPlanTemplate';
const WEEKS_COLLECTION = 'mealPlans';
const SINGLETON_DOC_ID = 'singleton';

export function subscribeMealPlanConfig(
  onConfig: (config: MealPlanConfig | null) => void,
  onError: (err: DomainError) => void,
): () => void {
  return subscribeDocument(
    {
      path: [CONFIG_COLLECTION, SINGLETON_DOC_ID],
      schema: MealPlanConfigSchema,
      label: 'MealPlanConfigSchema',
      onCorrupt: 'error',
      logsRejection: false,
      forwardsRawError: false,
    },
    (config) => onConfig(config as MealPlanConfig | null),
    onError,
  );
}

export function subscribeMealPlanTemplate(
  onTemplate: (template: MealPlanTemplate | null) => void,
  onError: (err: DomainError) => void,
): () => void {
  return subscribeDocument(
    {
      path: [TEMPLATE_COLLECTION, SINGLETON_DOC_ID],
      schema: MealPlanTemplateSchema,
      label: 'MealPlanTemplateSchema',
      onCorrupt: 'error',
      logsRejection: false,
      forwardsRawError: false,
    },
    (template) => onTemplate(template as MealPlanTemplate | null),
    onError,
  );
}

export function subscribeMealPlanWeek(
  startDate: string,
  onWeek: (week: MealPlanWeek | null) => void,
  onError: (err: DomainError) => void,
): () => void {
  return subscribeDocument(
    {
      // One dated document, not a singleton — the week IS the key.
      path: [WEEKS_COLLECTION, startDate],
      schema: MealPlanWeekSchema,
      label: 'MealPlanWeekSchema',
      onCorrupt: 'error',
      logsRejection: false,
      forwardsRawError: false,
    },
    (week) => onWeek(week as MealPlanWeek | null),
    onError,
  );
}

/**
 * One-shot read of a single week (issue #639).
 *
 * The load-template picker offers three weeks and must say which of them already
 * hold edits — including weeks nothing is subscribed to. Inferring "no edits"
 * from an absent in-memory document would answer that question by guessing, and
 * the wrong guess silently overwrites a real plan, so it reads the document.
 * Single-doc read contract: a corrupt doc is a `Failure`, never a throw.
 */
export async function loadMealPlanWeek(
  startDate: string,
): Promise<ReadResult<MealPlanWeek | null, DomainError>> {
  try {
    const db = getFirestore(getApp());
    const snap = await getDoc(doc(db, WEEKS_COLLECTION, startDate));
    if (!snap.exists()) return success(null);
    const result = MealPlanWeekSchema.safeParse(snap.data());
    if (!result.success) return failure({ kind: 'StorageError', reason: 'corruption' });
    return success(result.data as MealPlanWeek);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}

export async function saveMealPlanConfig(
  config: MealPlanConfig,
): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await setDoc(doc(db, CONFIG_COLLECTION, SINGLETON_DOC_ID), { ...config });
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}

export async function saveMealPlanTemplate(
  template: MealPlanTemplate,
): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await setDoc(doc(db, TEMPLATE_COLLECTION, SINGLETON_DOC_ID), { ...template });
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}

// Keyed by week.id (= startDate). Whole-document last-write-wins.
export async function saveMealPlanWeek(week: MealPlanWeek): Promise<ReadResult<void, DomainError>> {
  try {
    const db = getFirestore(getApp());
    await setDoc(doc(db, WEEKS_COLLECTION, week.id), { ...week });
    return success(undefined);
  } catch (err) {
    return failure(classifyFirestoreError(err));
  }
}
