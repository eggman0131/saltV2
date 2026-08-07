import type { Journey } from '../harness/journey.js';

import { authRules } from './auth-rules.js';

/** Every journey the runner can dispatch. Order is the `all` run order. */
export const JOURNEYS: readonly Journey[] = [authRules];

export function findJourney(name: string): Journey | undefined {
  return JOURNEYS.find((journey) => journey.name === name);
}
