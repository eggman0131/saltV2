import { logger } from 'firebase-functions';
import type { EntryParsePort } from '@salt/domain';
import { failure, success } from '@salt/shared-types';
import { parseEntryFlow } from '../flows/parseEntry.js';

export function createServerEntryParseAdapter(): EntryParsePort {
  return {
    async parse(rawText: string) {
      try {
        const value = await parseEntryFlow({ rawText });
        return success(value);
      } catch (err) {
        logger.error('parseEntry: AI parse failed', { err });
        return failure({ kind: 'NetworkError', reason: 'transient' });
      }
    },
  };
}
