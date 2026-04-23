// spec: SPEC.md §2 v0.3
import { createContext } from '../lib/context';

export type RadioGroupRegisteredItem = {
  value: string;
  el: HTMLElement;
  disabled: boolean;
};

export type RadioGroupState = {
  readonly value: string | undefined;
  readonly name: string;
  readonly orientation: 'horizontal' | 'vertical';
  readonly disabled: boolean;
  readonly required: boolean;
  readonly labelId: string;
  readonly descId: string | undefined;
  readonly errorId: string | undefined;
  readonly select: (val: string) => void;
  readonly isSelected: (val: string) => boolean;
  readonly isTabStop: (val: string) => boolean;
  readonly registerItem: (val: string, el: HTMLElement, disabled: boolean) => void;
  readonly unregisterItem: (val: string) => void;
  readonly handleItemKeydown: (e: KeyboardEvent, itemValue: string) => void;
};

export const RADIO_GROUP_CONTEXT = createContext<RadioGroupState>('RadioGroup');

export function createRadioGroupState(opts: {
  value: () => string | undefined;
  setValue: (v: string) => void;
  name: () => string;
  orientation: () => 'horizontal' | 'vertical';
  disabled: () => boolean;
  required: () => boolean;
  labelId: string;
  descId: string | undefined;
  errorId: string | undefined;
  getItems: () => RadioGroupRegisteredItem[];
  addItem: (val: string, el: HTMLElement, disabled: boolean) => void;
  removeItem: (val: string) => void;
  getRovingValue: () => string | undefined;
  setRovingValue: (val: string | undefined) => void;
}): RadioGroupState {
  function getEnabledItems(): RadioGroupRegisteredItem[] {
    return opts.getItems().filter((i) => !i.disabled && !opts.disabled());
  }

  function effectiveTabStop(): string | undefined {
    const items = opts.getItems();
    const roving = opts.getRovingValue();
    const enabled = getEnabledItems();

    if (roving !== undefined && enabled.some((i) => i.value === roving)) {
      return roving;
    }
    const cur = opts.value();
    if (cur !== undefined && items.some((i) => i.value === cur)) return cur;
    return items[0]?.value;
  }

  function moveFocus(direction: 1 | -1 | 'first' | 'last'): void {
    if (opts.disabled()) return;
    const enabled = getEnabledItems();
    if (enabled.length === 0) return;

    const currentIdx = enabled.findIndex((i) => i.el === document.activeElement);

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
          : (currentIdx + direction + enabled.length) % enabled.length;
    }

    const next = enabled[nextIdx];
    if (next) {
      opts.setRovingValue(next.value);
      next.el.focus();
    }
  }

  return {
    get value() {
      return opts.value();
    },
    get name() {
      return opts.name();
    },
    get orientation() {
      return opts.orientation();
    },
    get disabled() {
      return opts.disabled();
    },
    get required() {
      return opts.required();
    },
    labelId: opts.labelId,
    descId: opts.descId,
    errorId: opts.errorId,

    select(val: string) {
      if (!opts.disabled()) {
        opts.setValue(val);
        opts.setRovingValue(val);
      }
    },

    isSelected(val: string) {
      return opts.value() === val;
    },

    isTabStop(val: string) {
      return effectiveTabStop() === val;
    },

    registerItem(val: string, el: HTMLElement, disabled: boolean) {
      opts.addItem(val, el, disabled);
    },

    unregisterItem(val: string) {
      opts.removeItem(val);
    },

    handleItemKeydown(e: KeyboardEvent, itemValue: string) {
      if (opts.disabled()) return;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          moveFocus(1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          moveFocus(-1);
          break;
        case 'Home':
          e.preventDefault();
          moveFocus('first');
          break;
        case 'End':
          e.preventDefault();
          moveFocus('last');
          break;
        case ' ':
          e.preventDefault();
          opts.setValue(itemValue);
          opts.setRovingValue(itemValue);
          break;
      }
    },
  };
}
