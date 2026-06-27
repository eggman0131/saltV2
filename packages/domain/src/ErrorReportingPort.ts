import type { DomainError } from '@salt/shared-types';

// Best-effort, category-gated error reporting boundary (CLAUDE.md §Observability).
// `category` is the DomainError `kind` — it drives the report/suppress gate
// ("report the unexpected, suppress the expected"). The raw `error` carries the
// stack to the reporting backend. Domain stays pure: this is only the port shape,
// the gate + backend live in @salt/observability. Implementations must never
// throw across this boundary (Rule 10).
export interface ErrorReportingPort {
  report(error: unknown, category: DomainError['kind']): void;
}
