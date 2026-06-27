import type { DomainError } from '@salt/shared-types';

// Best-effort, category-gated error reporting boundary (CLAUDE.md §Observability).
// `category` is the DomainError `kind` — it drives the report/suppress gate
// ("report the unexpected, suppress the expected"). The raw `error` carries the
// stack to the reporting backend. Domain stays pure: this is only the port shape,
// the gate + backend live in @salt/observability. Implementations must never
// throw across this boundary (Rule 10).
//
// `category` is OPTIONAL: client call sites always pass a classified
// DomainError['kind'] (back-compatible — unchanged for them), but server call
// sites usually catch RAW, uncategorised exceptions (there is no server
// classifyFirestoreError), so they omit it. An absent category is "the
// unexpected" → reportable, per the gate's single source of truth
// (isReportableCategory, widened to accept `undefined`).
export interface ErrorReportingPort {
  report(error: unknown, category?: DomainError['kind']): void;
}
