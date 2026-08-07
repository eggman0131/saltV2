import type { ProbeContext } from './runner.js';

/** One self-contained journey. Registered in `probes/journeys/index.ts`. */
export interface Journey {
  /** CLI name — `pnpm probe <name>`. */
  readonly name: string;
  readonly description: string;
  run(ctx: ProbeContext): Promise<void>;
}
