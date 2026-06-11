// An optional timer attached to a step, e.g. "simmer for 20 minutes".
export interface StepTimer {
  readonly durationMinutes: number;
  readonly description: string | null;
}

export interface Step {
  readonly id: string;
  readonly text: string;
  readonly timer: StepTimer | null;
}
