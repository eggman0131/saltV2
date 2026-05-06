import { logger } from 'firebase-functions';
import { summarizeMatchLog } from '@salt/domain';
import type { MatchLoggingPort } from '@salt/domain';

export function createServerMatchLoggingAdapter(): MatchLoggingPort {
  return {
    write(entry) {
      const { oneLine } = summarizeMatchLog(entry);
      logger.info('canon.match', {
        path: 'cf',
        summary: oneLine,
        correlationId: entry.id,
        decision: entry.finalDecision,
        rawInput: entry.rawInput,
        normalizedInput: entry.normalizedInput,
        finalItemId: entry.finalItemId,
        finalItemName: entry.finalItemName,
        inputItemCount: entry.inputItemCount,
        totalDurationMs: entry.totalDurationMs,
      });
      return Promise.resolve();
    },
  };
}
