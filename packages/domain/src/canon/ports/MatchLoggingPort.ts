import type { MatchLogEntry } from '../entities/MatchLogEntry.js';

export interface MatchLoggingPort {
  write(entry: MatchLogEntry): Promise<void>;
}
