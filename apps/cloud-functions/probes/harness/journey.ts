import type { ProbeContext } from './runner.js';

/** One self-contained journey. Registered in `probes/journeys/index.ts`. */
export interface Journey {
  /** CLI name — `pnpm probe <name>`. */
  readonly name: string;
  readonly description: string;
  /**
   * True when a run spends real money beyond an embedding call — image
   * generation, photo import. Excluded from the default `all` sweep and run
   * only under `--include-expensive`, or when named explicitly.
   */
  readonly expensive?: boolean;
  run(ctx: ProbeContext): Promise<void>;
}
