// spec: SPEC.md §8.7 v0.2.3
import { createContext } from '../lib/context';

export type PopoverState = {
  readonly portal: HTMLElement | string | false;
  readonly trapFocus: boolean;
};

export const POPOVER_CONTEXT = createContext<PopoverState>('Popover');

export function createPopoverState(opts: {
  portal: () => HTMLElement | string | false;
  trapFocus: () => boolean;
}): PopoverState {
  return {
    get portal() {
      return opts.portal();
    },
    get trapFocus() {
      return opts.trapFocus();
    },
  };
}
