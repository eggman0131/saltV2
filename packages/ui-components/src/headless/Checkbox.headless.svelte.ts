// spec: SPEC.md §8.4 v0.2.3
import { useId } from '../lib/useId';

export type CheckedState = boolean | 'indeterminate';

export type CheckboxState = {
  readonly id: string;
  readonly descId: string;
  readonly errorId: string;
  readonly hasError: boolean;
  readonly hasDescription: boolean;
  readonly describedBy: string | undefined;
};

export function createCheckboxState(opts: {
  id: () => string | undefined;
  error: () => string | undefined;
  description: () => string | undefined;
}): CheckboxState {
  const generatedId = useId('checkbox');
  return {
    get id() {
      return opts.id() ?? generatedId;
    },
    get descId() {
      return `${this.id}-desc`;
    },
    get errorId() {
      return `${this.id}-error`;
    },
    get hasError() {
      return !!opts.error();
    },
    get hasDescription() {
      return !!opts.description();
    },
    get describedBy() {
      const ids: string[] = [];
      if (this.hasError) ids.push(this.errorId);
      if (this.hasDescription) ids.push(this.descId);
      return ids.length ? ids.join(' ') : undefined;
    },
  };
}
