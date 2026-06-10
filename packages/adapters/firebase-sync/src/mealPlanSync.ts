import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';
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
  const db = getFirestore(getApp());
  return onSnapshot(
    doc(db, CONFIG_COLLECTION, SINGLETON_DOC_ID),
    (snap) => {
      if (!snap.exists()) {
        onConfig(null);
        return;
      }
      const result = MealPlanConfigSchema.safeParse(snap.data());
      if (!result.success) {
        onError({ kind: 'StorageError', reason: 'corruption' });
        return;
      }
      onConfig(result.data as MealPlanConfig);
    },
    (err) => onError(classifyFirestoreError(err)),
  );
}

export function subscribeMealPlanTemplate(
  onTemplate: (template: MealPlanTemplate | null) => void,
  onError: (err: DomainError) => void,
): () => void {
  const db = getFirestore(getApp());
  return onSnapshot(
    doc(db, TEMPLATE_COLLECTION, SINGLETON_DOC_ID),
    (snap) => {
      if (!snap.exists()) {
        onTemplate(null);
        return;
      }
      const result = MealPlanTemplateSchema.safeParse(snap.data());
      if (!result.success) {
        onError({ kind: 'StorageError', reason: 'corruption' });
        return;
      }
      onTemplate(result.data as MealPlanTemplate);
    },
    (err) => onError(classifyFirestoreError(err)),
  );
}

export function subscribeMealPlanWeek(
  startDate: string,
  onWeek: (week: MealPlanWeek | null) => void,
  onError: (err: DomainError) => void,
): () => void {
  const db = getFirestore(getApp());
  return onSnapshot(
    doc(db, WEEKS_COLLECTION, startDate),
    (snap) => {
      if (!snap.exists()) {
        onWeek(null);
        return;
      }
      const result = MealPlanWeekSchema.safeParse(snap.data());
      if (!result.success) {
        onError({ kind: 'StorageError', reason: 'corruption' });
        return;
      }
      onWeek(result.data as MealPlanWeek);
    },
    (err) => onError(classifyFirestoreError(err)),
  );
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
