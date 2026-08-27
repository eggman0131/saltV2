/**
 * The slice of firebase-admin's `Timestamp` the ledger claim uses (#1008):
 * `fromMillis` at the write site, `toMillis` in each suite's offset assertion.
 *
 * Shared by the three dispatch trigger suites (#1023, per unit-test-spec UT-C4).
 * Each stands it in for the real SDK class via
 * `vi.mock('firebase-admin/firestore', () => ({ …, Timestamp: FakeTimestamp }))`,
 * and then asserts `expect.any(FakeTimestamp)` — a real TYPE assertion, which a
 * regression to a number or a string fails. Keep it this small: the explicit
 * annotations are the only types this file gets, since `apps/cloud-functions/tests`
 * is outside the root `typecheck` (#942).
 */
export class FakeTimestamp {
  private readonly ms: number;
  constructor(ms: number) {
    this.ms = ms;
  }
  static fromMillis(ms: number): FakeTimestamp {
    return new FakeTimestamp(ms);
  }
  toMillis(): number {
    return this.ms;
  }
}
