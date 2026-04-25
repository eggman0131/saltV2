// spec: SPEC.md §3 v0.3
import { createContext } from '../lib/context';

export type SelectRegisteredItem = {
  value: string;
  label: string;
  id: string;
  el: HTMLElement;
  disabled: boolean;
};

export type SelectState = {
  readonly open: boolean;
  readonly value: string | undefined;
  readonly disabled: boolean;
  readonly required: boolean;
  readonly placeholder: string | undefined;
  readonly portal: HTMLElement | string | false;
  readonly listboxId: string;
  readonly triggerId: string;
  readonly activeOptionId: string | undefined;
  readonly displayLabel: string | undefined;

  readonly openList: () => void;
  readonly closeList: (focus?: boolean) => void;
  readonly toggle: () => void;
  readonly initializeOpen: () => void;
  readonly selectOption: (val: string) => void;
  readonly isSelected: (val: string) => boolean;
  readonly isActive: (val: string) => boolean;
  readonly setActive: (val: string | undefined) => void;

  readonly registerItem: (item: SelectRegisteredItem) => void;
  readonly unregisterItem: (val: string) => void;

  readonly handleTriggerKeydown: (e: KeyboardEvent) => void;
  readonly handleListboxKeydown: (e: KeyboardEvent) => void;

  readonly triggerEl: HTMLElement | undefined;
  readonly setTriggerEl: (el: HTMLElement | undefined) => void;
};

export const SELECT_CONTEXT = createContext<SelectState>('Select');

export function createSelectState(opts: {
  value: () => string | undefined;
  setValue: (v: string) => void;
  open: () => boolean;
  setOpen: (v: boolean) => void;
  disabled: () => boolean;
  required: () => boolean;
  placeholder: () => string | undefined;
  portal: () => HTMLElement | string | false;
  listboxId: string;
  triggerId: string;
  getItems: () => SelectRegisteredItem[];
  addItem: (item: SelectRegisteredItem) => void;
  removeItem: (val: string) => void;
  getActiveOption: () => string | undefined;
  setActiveOption: (val: string | undefined) => void;
  getTriggerEl: () => HTMLElement | undefined;
  setTriggerEl: (el: HTMLElement | undefined) => void;
  getTypeaheadBuffer: () => string;
  setTypeaheadBuffer: (v: string) => void;
  getTypeaheadTimer: () => ReturnType<typeof setTimeout> | undefined;
  setTypeaheadTimer: (v: ReturnType<typeof setTimeout> | undefined) => void;
}): SelectState {
  function getEnabledItems(): SelectRegisteredItem[] {
    return opts.getItems().filter((i) => !i.disabled);
  }

  function focusTrigger(): void {
    Promise.resolve().then(() => opts.getTriggerEl()?.focus());
  }

  function moveActive(direction: 1 | -1 | 'first' | 'last'): void {
    const enabled = getEnabledItems();
    if (!enabled.length) return;

    const currentIdx = enabled.findIndex((i) => i.value === opts.getActiveOption());
    let nextIdx: number;

    if (direction === 'first') {
      nextIdx = 0;
    } else if (direction === 'last') {
      nextIdx = enabled.length - 1;
    } else {
      nextIdx =
        currentIdx === -1
          ? direction === 1
            ? 0
            : enabled.length - 1
          : Math.max(0, Math.min(enabled.length - 1, currentIdx + direction));
    }

    const next = enabled[nextIdx];
    if (next) {
      opts.setActiveOption(next.value);
      next.el.scrollIntoView?.({ block: 'nearest' });
    }
  }

  function doTypeahead(char: string): void {
    const timer = opts.getTypeaheadTimer();
    if (timer !== undefined) clearTimeout(timer);

    const newBuffer = opts.getTypeaheadBuffer() + char.toLowerCase();
    opts.setTypeaheadBuffer(newBuffer);

    opts.setTypeaheadTimer(
      setTimeout(() => {
        opts.setTypeaheadBuffer('');
        opts.setTypeaheadTimer(undefined);
      }, 1000),
    );

    const enabled = getEnabledItems();
    const currentIdx = enabled.findIndex((i) => i.value === opts.getActiveOption());
    const searchFrom = currentIdx === -1 ? 0 : currentIdx + 1;
    const rotated = [...enabled.slice(searchFrom), ...enabled.slice(0, searchFrom)];
    const match = rotated.find((i) => i.label.toLowerCase().startsWith(newBuffer));

    if (match) {
      opts.setActiveOption(match.value);
      match.el.scrollIntoView?.({ block: 'nearest' });
    }
  }

  function openList(): void {
    if (opts.disabled()) return;
    opts.setOpen(true);
  }

  function closeList(focus = true): void {
    opts.setOpen(false);
    opts.setActiveOption(undefined);
    if (focus) focusTrigger();
  }

  function selectOption(val: string): void {
    opts.setValue(val);
    opts.setOpen(false);
    opts.setActiveOption(undefined);
    focusTrigger();
  }

  return {
    get open() {
      return opts.open();
    },
    get value() {
      return opts.value();
    },
    get disabled() {
      return opts.disabled();
    },
    get required() {
      return opts.required();
    },
    get placeholder() {
      return opts.placeholder();
    },
    get portal() {
      return opts.portal();
    },
    listboxId: opts.listboxId,
    triggerId: opts.triggerId,

    get activeOptionId() {
      const active = opts.getActiveOption();
      if (!active) return undefined;
      return opts.getItems().find((i) => i.value === active)?.id;
    },

    get displayLabel() {
      const v = opts.value();
      if (!v) return undefined;
      return opts.getItems().find((i) => i.value === v)?.label;
    },

    openList,
    closeList,

    toggle() {
      if (opts.open()) {
        closeList(true);
      } else {
        openList();
      }
    },

    initializeOpen() {
      const enabled = getEnabledItems();
      const selected = enabled.find((i) => i.value === opts.value());
      const initial = selected ?? enabled[0];
      if (initial) opts.setActiveOption(initial.value);
    },

    selectOption,

    isSelected(val: string) {
      return opts.value() === val;
    },

    isActive(val: string) {
      return opts.getActiveOption() === val;
    },

    setActive(val: string | undefined) {
      opts.setActiveOption(val);
    },

    registerItem(item: SelectRegisteredItem) {
      opts.addItem(item);
    },

    unregisterItem(val: string) {
      opts.removeItem(val);
    },

    handleTriggerKeydown(e: KeyboardEvent) {
      if (opts.disabled()) return;
      switch (e.key) {
        case ' ':
        case 'Enter':
        case 'ArrowDown':
        case 'ArrowUp':
          e.preventDefault();
          openList();
          break;
      }
    },

    handleListboxKeydown(e: KeyboardEvent) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          moveActive(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          moveActive(-1);
          break;
        case 'Home':
          e.preventDefault();
          moveActive('first');
          break;
        case 'End':
          e.preventDefault();
          moveActive('last');
          break;
        case 'Enter':
        case ' ': {
          e.preventDefault();
          const active = opts.getActiveOption();
          if (active) selectOption(active);
          break;
        }
        case 'Escape':
          e.preventDefault();
          closeList(true);
          break;
        default:
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            doTypeahead(e.key);
          }
      }
    },

    get triggerEl() {
      return opts.getTriggerEl();
    },
    setTriggerEl(el: HTMLElement | undefined) {
      opts.setTriggerEl(el);
    },
  };
}
