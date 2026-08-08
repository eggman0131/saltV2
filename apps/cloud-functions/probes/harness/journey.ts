import type { ProbeContext } from './runner.js';

/** One self-contained journey. Registered in `probes/journeys/index.ts`. */
export interface Journey {
  /** CLI name — `pnpm probe <name>`. */
  readonly name: string;
  readonly description: string;
  /**
   * Set when a run has a consequence beyond reading and cleaning up after
   * itself — real money (image generation) or a real-world side effect (a push
   * notification to someone's actual phone). The value is the reason, shown in
   * `--help`; its presence excludes the journey from the default `all` sweep.
   * Naming the journey explicitly always runs it.
   */
  readonly optIn?: string;
  run(ctx: ProbeContext): Promise<void>;
}
