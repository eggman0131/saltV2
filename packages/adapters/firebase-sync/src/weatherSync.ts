import { getFirestore, doc, onSnapshot } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import type { DomainError } from '@salt/shared-types';
import { WeatherForecastSchema, type WeatherForecast } from '@salt/domain/schemas';
import { classifyFirestoreError } from './firestoreErrors.js';

// Weather forecast cache subscription (issue #382, Phase 2). The CF writes the
// pre-aggregated forecast to weatherForecast/singleton via the Admin SDK; this
// CLIENT-side (web SDK) subscription reads it for the admin readout (Phase 2) and
// the planner (Phase 3). A single-document read: a corrupt doc surfaces a Failure
// via onError per the single-doc read contract (CLAUDE.md Rule 10 — never throw);
// a missing doc yields null (no forecast fetched yet). The shared
// WeatherForecastSchema (domain) is the single source of truth for the doc shape,
// matching the CF write.

const COLLECTION = 'weatherForecast';
const SINGLETON_DOC_ID = 'singleton';

export function subscribeWeatherForecast(
  onForecast: (forecast: WeatherForecast | null) => void,
  onError: (err: DomainError) => void,
): () => void {
  const db = getFirestore(getApp());
  return onSnapshot(
    doc(db, COLLECTION, SINGLETON_DOC_ID),
    (snap) => {
      if (!snap.exists()) {
        onForecast(null);
        return;
      }
      const result = WeatherForecastSchema.safeParse(snap.data());
      if (!result.success) {
        onError({ kind: 'StorageError', reason: 'corruption' });
        return;
      }
      onForecast(result.data);
    },
    (err) => onError(classifyFirestoreError(err)),
  );
}
