// spec: ui-spec-v04.md §6 v0.4
import { createContext } from '../lib/context';
import type { ComboboxItem } from '../primitives/Combobox/Combobox.types';

export type ComboboxState = {
  readonly inputValue: string;
  readonly open: boolean;
  readonly activeIndex: number | null;
  readonly filteredItems: ComboboxItem[];
  readonly selectedValue: string | undefined;
  readonly showCreate: boolean;
  readonly listboxId: string;
  readonly inputId: string;
  readonly portal: HTMLElement | string | false;
  readonly placeholder: string | undefined;
  readonly anchorEl: HTMLElement | null;

  readonly setAnchorEl: (el: HTMLElement | null) => void;
  readonly setInputValue: (v: string) => void;
  readonly openPopup: () => void;
  readonly openWhenTyping: () => void;
  readonly closePopup: () => void;
  readonly togglePopup: () => void;
  readonly moveActive: (delta: number | 'first' | 'last') => void;
  readonly selectActive: () => void;
  readonly selectItem: (value: string) => void;
  readonly createCustom: () => void;
  readonly handleInputKeydown: (e: KeyboardEvent) => void;
  readonly handleInputBlur: () => void;
  readonly setActiveIndex: (index: number | null) => void;

  readonly isSelected: (value: string) => boolean;
  readonly isActive: (index: number) => boolean;
  readonly getItemId: (index: number) => string;
  readonly getActiveDescendantId: () => string | undefined;
};

export const COMBOBOX_CONTEXT = createContext<ComboboxState>('Combobox');

export function createComboboxState(opts: {
  value: () => string | undefined;
  setValue: (v: string | undefined) => void;
  open: () => boolean;
  setOpen: (v: boolean) => void;
  // inputValue: text shown in the <input> element
  inputValue: () => string;
  setInputValue: (v: string) => void;
  // filterValue: text used for list filtering — reset to '' on open/select
  filterValue: () => string;
  setFilterValue: (v: string) => void;
  activeIndex: () => number | null;
  setActiveIndex: (v: number | null) => void;
  items: () => ComboboxItem[];
  filterFn: () => ((input: string, item: ComboboxItem) => boolean) | undefined;
  allowCustom: () => boolean;
  restrict: () => boolean;
  portal: () => HTMLElement | string | false;
  placeholder: () => string | undefined;
  listboxId: string;
  inputId: string;
  getOnCreate: () => ((v: string) => void) | undefined;
  anchorEl: () => HTMLElement | null;
  setAnchorEl: (el: HTMLElement | null) => void;
}): ComboboxState {
  function defaultFilter(input: string, item: ComboboxItem): boolean {
    return item.label.toLowerCase().includes(input.trim().toLowerCase());
  }

  function computeFilteredItems(): ComboboxItem[] {
    const input = opts.filterValue().trim();
    const fn = opts.filterFn() ?? defaultFilter;
    if (!input) return opts.items();
    return opts.items().filter((item) => fn(input, item));
  }

  function computeShowCreate(): boolean {
    if (!opts.allowCustom()) return false;
    const input = opts.filterValue().trim();
    if (!input) return false;
    return !computeFilteredItems().some((item) => item.label.toLowerCase() === input.toLowerCase());
  }

  function totalCount(): number {
    return computeFilteredItems().length + (computeShowCreate() ? 1 : 0);
  }

  function openPopup(): void {
    opts.setFilterValue('');
    opts.setOpen(true);
    // Pre-set active to the selected item's position so navigation starts from there
    const cur = opts.value();
    if (cur !== undefined) {
      const idx = opts.items().findIndex((i) => i.value === cur);
      if (idx !== -1) opts.setActiveIndex(idx);
    }
  }

  function closePopup(): void {
    opts.setOpen(false);
    opts.setActiveIndex(null);
  }

  function selectItem(value: string): void {
    const item = opts.items().find((i) => i.value === value);
    const label = item?.label ?? value;
    opts.setInputValue(label);
    opts.setFilterValue('');
    opts.setValue(value);
    opts.setOpen(false);
    opts.setActiveIndex(null);
  }

  function createCustom(): void {
    const input = opts.filterValue().trim();
    if (!input) return;
    opts.setInputValue(input);
    opts.setFilterValue('');
    opts.setValue(input);
    opts.setOpen(false);
    opts.setActiveIndex(null);
    opts.getOnCreate()?.(input);
  }

  function moveActive(delta: number | 'first' | 'last'): void {
    const total = totalCount();
    if (total === 0) return;
    const current = opts.activeIndex();
    let next: number;
    if (delta === 'first') {
      next = 0;
    } else if (delta === 'last') {
      next = total - 1;
    } else {
      if (current === null) {
        next = delta > 0 ? 0 : total - 1;
      } else {
        next = Math.max(0, Math.min(total - 1, current + delta));
      }
    }
    opts.setActiveIndex(next);
  }

  function selectActive(): void {
    const idx = opts.activeIndex();
    const filtered = computeFilteredItems();
    if (idx === null) {
      if (opts.allowCustom()) {
        const input = opts.filterValue().trim();
        if (input) createCustom();
      }
      return;
    }
    if (idx < filtered.length) {
      const item = filtered[idx];
      if (item) selectItem(item.value);
    } else if (idx === filtered.length && computeShowCreate()) {
      createCustom();
    }
  }

  function handleInputKeydown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!opts.open()) {
          openPopup();
          Promise.resolve().then(() => moveActive(1));
        } else {
          moveActive(1);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!opts.open()) {
          openPopup();
          Promise.resolve().then(() => moveActive('last'));
        } else {
          moveActive(-1);
        }
        break;
      case 'Enter':
        if (opts.open()) {
          e.preventDefault();
          selectActive();
        }
        break;
      case 'Escape':
        if (opts.open()) {
          e.preventDefault();
          const cur = opts.value();
          if (cur) {
            const item = opts.items().find((i) => i.value === cur);
            opts.setInputValue(item?.label ?? '');
          } else {
            opts.setInputValue('');
          }
          opts.setFilterValue('');
          closePopup();
        }
        break;
      case 'Home':
        if (opts.open()) {
          e.preventDefault();
          moveActive('first');
        }
        break;
      case 'End':
        if (opts.open()) {
          e.preventDefault();
          moveActive('last');
        }
        break;
      case 'Tab': {
        if (opts.open()) {
          const idx = opts.activeIndex();
          const filtered = computeFilteredItems();
          if (idx !== null) {
            if (idx < filtered.length) {
              const item = filtered[idx];
              if (item) selectItem(item.value);
            } else if (computeShowCreate()) {
              createCustom();
            }
          } else if (opts.allowCustom()) {
            const input = opts.filterValue().trim();
            if (input && !filtered.some((i) => i.label.toLowerCase() === input.toLowerCase())) {
              createCustom();
            }
          }
          if (opts.open()) {
            opts.setOpen(false);
            opts.setActiveIndex(null);
          }
        }
        break;
      }
    }
  }

  function handleInputBlur(): void {
    Promise.resolve().then(() => {
      if (!opts.open()) return;
      opts.setOpen(false);
      opts.setActiveIndex(null);
      opts.setFilterValue('');
      if (opts.restrict()) {
        const cur = opts.value();
        if (cur) {
          const item = opts.items().find((i) => i.value === cur);
          opts.setInputValue(item?.label ?? '');
        } else {
          const input = opts.inputValue().trim();
          const match = opts.items().find((i) => i.label.toLowerCase() === input.toLowerCase());
          if (!match) opts.setInputValue('');
        }
      }
    });
  }

  return {
    get inputValue() {
      return opts.inputValue();
    },
    get open() {
      return opts.open();
    },
    get activeIndex() {
      return opts.activeIndex();
    },
    get filteredItems() {
      return computeFilteredItems();
    },
    get selectedValue() {
      return opts.value();
    },
    get showCreate() {
      return computeShowCreate();
    },
    get portal() {
      return opts.portal();
    },
    get placeholder() {
      return opts.placeholder();
    },
    listboxId: opts.listboxId,
    inputId: opts.inputId,
    get anchorEl() {
      return opts.anchorEl();
    },

    setAnchorEl(el: HTMLElement | null) {
      opts.setAnchorEl(el);
    },
    setInputValue(v: string) {
      opts.setInputValue(v);
      opts.setFilterValue(v);
      opts.setActiveIndex(null);
    },
    openPopup,
    openWhenTyping() {
      opts.setOpen(true);
    },
    closePopup,
    togglePopup() {
      if (opts.open()) {
        closePopup();
      } else {
        openPopup();
      }
    },
    moveActive,
    selectActive,
    selectItem,
    createCustom,
    handleInputKeydown,
    handleInputBlur,
    setActiveIndex(index: number | null) {
      opts.setActiveIndex(index);
    },

    isSelected(value: string) {
      return opts.value() === value;
    },
    isActive(index: number) {
      return opts.activeIndex() === index;
    },
    getItemId(index: number) {
      return `${opts.listboxId}-option-${index}`;
    },
    getActiveDescendantId() {
      const idx = opts.activeIndex();
      if (idx === null) return undefined;
      return `${opts.listboxId}-option-${idx}`;
    },
  };
}
