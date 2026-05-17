import type { ReadResult, DomainError } from '@salt/shared-types';
import type { ParsedEntry } from '../queries/parseEntry.js';

// AI-fallback port for structured entry parsing. This is the single
// designated extension point for future structured parsing (e.g.
// amount/unit): add new optional fields to ParsedEntry and extend the
// adapter's prompt — do not add a parallel port or a second parse pass.
export interface EntryParsePort {
  parse(rawText: string): Promise<ReadResult<ParsedEntry, DomainError>>;
}
