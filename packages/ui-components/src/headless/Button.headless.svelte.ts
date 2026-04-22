// spec: SPEC.md §3.6 v0.2.3
export type ButtonState = {
  readonly loading: boolean;
  readonly disabled: boolean;
  readonly interactive: boolean; // !disabled && !loading
};

export function createButtonState(opts: {
  disabled: () => boolean;
  loading: () => boolean;
}): ButtonState {
  return {
    get loading() {
      return opts.loading();
    },
    get disabled() {
      return opts.disabled();
    },
    get interactive() {
      return !opts.disabled() && !opts.loading();
    },
  };
}
