// spec: SPEC.md §9.1 v0.4.0
import { createContext } from '../../lib/context.js';

export type ListPageContext = {
  readonly selectionMode: boolean;
  readonly exitSelectionMode: () => void;
};

export const LIST_PAGE_CONTEXT = createContext<ListPageContext>('ListPage');
