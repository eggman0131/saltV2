import { logger } from 'firebase-functions';
import type { EntryParsePort, ParsedEntry } from '@salt/domain';
import { failure, success } from '@salt/shared-types';
import { parseEntryFlow } from '../flows/parseEntry.js';
import { withAiTimeout } from './withAiTimeout.js';

export function createServerEntryParseAdapter(): EntryParsePort {
  return {
    async parse(rawText: string) {
      try {
        const value = await withAiTimeout('parseEntry', () => parseEntryFlow({ rawText }));
        // Construct ParsedEntry explicitly so optional fields are absent (not
        // undefined) — required by exactOptionalPropertyTypes.
        const parsed: ParsedEntry = {
          name: value.name,
          context: value.context,
          ...(value.amount !== undefined ? { amount: value.amount } : undefined),
          ...(value.unit !== undefined ? { unit: value.unit } : undefined),
        };
        return success(parsed);
      } catch (err) {
        logger.error('parseEntry: AI parse failed', { err });
        return failure({ kind: 'NetworkError', reason: 'transient' });
      }
    },
  };
}
