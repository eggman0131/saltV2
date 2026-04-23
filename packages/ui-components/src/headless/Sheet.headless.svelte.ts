// spec: SPEC.md §5 v0.3
import { createContext } from '../lib/context';

export type SheetState = {
  readonly portal: HTMLElement | string | false;
  readonly side: 'left' | 'right' | 'top' | 'bottom';
};

export const SHEET_CONTEXT = createContext<SheetState>('Sheet');

export function createSheetState(opts: {
  portal: () => HTMLElement | string | false;
  side: () => 'left' | 'right' | 'top' | 'bottom';
}): SheetState {
  return {
    get portal() {
      return opts.portal();
    },
    get side() {
      return opts.side();
    },
  };
}
