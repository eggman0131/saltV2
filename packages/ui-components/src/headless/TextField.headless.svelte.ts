// spec: SPEC.md §8.2 v0.2.3
import { useId } from '../lib/useId';

export type TextFieldState = {
  readonly id: string;
  readonly descId: string;
  readonly errorId: string;
  readonly hasError: boolean;
  readonly hasDescription: boolean;
  readonly describedBy: string | undefined;
};

export function createTextFieldState(opts: {
  id: () => string | undefined;
  error: () => string | undefined;
  description: () => string | undefined;
}): TextFieldState {
  const generatedId = useId('textfield');
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
