export interface ErrorReportingPort {
  report(error: unknown): void;
}
