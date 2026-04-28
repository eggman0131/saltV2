import type { MatchLogEntry } from '../logging/MatchLogEntry.js';

export interface MatchLoggingPort {
  write(entry: MatchLogEntry): Promise<void>;
}
