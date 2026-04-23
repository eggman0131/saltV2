// spec: SPEC.md §8.8 v0.2.3
import { createContext } from '../lib/context';

export type TooltipState = {
  readonly mounted: true;
};

export const TOOLTIP_CONTEXT = createContext<TooltipState>('Tooltip');

export function createTooltipState(): TooltipState {
  return { mounted: true };
}
