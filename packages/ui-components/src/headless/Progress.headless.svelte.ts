// spec: SPEC.md §8.15 v0.2.3

export type ProgressState = {
  readonly isIndeterminate: boolean;
  readonly clampedValue: number | undefined;
  readonly percent: number;
  readonly bitsValue: number | null;
};

export function createProgressState(opts: {
  value: () => number | undefined;
  max: () => number;
}): ProgressState {
  return {
    get isIndeterminate() {
      return opts.value() === undefined;
    },
    get clampedValue() {
      const v = opts.value();
      if (v === undefined) return undefined;
      return Math.min(Math.max(v, 0), opts.max());
    },
    get percent() {
      const v = this.clampedValue;
      if (v === undefined) return 0;
      return (v / opts.max()) * 100;
    },
    get bitsValue() {
      const v = this.clampedValue;
      return v === undefined ? null : v;
    },
  };
}
