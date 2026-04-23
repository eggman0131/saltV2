// spec: SPEC.md §8.6 v0.2.3
import { createContext } from '../lib/context';

export type DialogState = {
  readonly portal: HTMLElement | string | false;
};

export const DIALOG_CONTEXT = createContext<DialogState>('Dialog');

export function createDialogState(opts: {
  portal: () => HTMLElement | string | false;
}): DialogState {
  return {
    get portal() {
      return opts.portal();
    },
  };
}
