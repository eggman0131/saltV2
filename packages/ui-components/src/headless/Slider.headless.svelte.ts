// spec: SPEC.md §4 v0.3
import { createContext } from '../lib/context';

export type SliderState = {
  readonly value: number | [number, number];
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly orientation: 'horizontal' | 'vertical';
  readonly disabled: boolean;
  readonly isRange: boolean;
  readonly activeThumbIdx: number;
  readonly setActiveThumbIdx: (idx: number) => void;
  readonly getThumbValue: (idx: number) => number;
  readonly percentForThumb: (idx: number) => number;
  readonly handleThumbKeydown: (e: KeyboardEvent, thumbIdx: number) => void;
  readonly handleTrackPointerDown: (e: PointerEvent, trackEl: HTMLElement) => void;
  readonly claimThumbIndex: () => number;
};

export const SLIDER_CONTEXT = createContext<SliderState>('Slider');

export function createSliderState(opts: {
  value: () => number | [number, number];
  setValue: (v: number | [number, number]) => void;
  min: () => number;
  max: () => number;
  step: () => number;
  orientation: () => 'horizontal' | 'vertical';
  disabled: () => boolean;
  getActiveThumb: () => number;
  setActiveThumb: (idx: number) => void;
  claimThumbIndex: () => number;
}): SliderState {
  function clamp(v: number, lo: number, hi: number): number {
    return Math.min(Math.max(v, lo), hi);
  }

  function snapToStep(v: number): number {
    const min = opts.min();
    const step = opts.step();
    const snapped = Math.round((v - min) / step) * step + min;
    // avoid floating-point artifacts (e.g. 0.1 + 0.2)
    return parseFloat(snapped.toFixed(10));
  }

  function isRange(): boolean {
    return Array.isArray(opts.value());
  }

  function getThumbValue(idx: number): number {
    const val = opts.value();
    if (Array.isArray(val)) return val[idx] ?? val[0];
    return val;
  }

  function percentForThumb(idx: number): number {
    const min = opts.min();
    const max = opts.max();
    if (max === min) return 0;
    return ((getThumbValue(idx) - min) / (max - min)) * 100;
  }

  function updateThumb(thumbIdx: number, rawVal: number): void {
    if (opts.disabled()) return;
    const min = opts.min();
    const max = opts.max();
    const val = opts.value();
    const snapped = snapToStep(rawVal);

    if (Array.isArray(val)) {
      // Range: enforce value[0] <= value[1]
      const next: number =
        thumbIdx === 0 ? clamp(snapped, min, val[1]) : clamp(snapped, val[0], max);
      opts.setValue(thumbIdx === 0 ? [next, val[1]] : [val[0], next]);
    } else {
      opts.setValue(clamp(snapped, min, max));
    }
  }

  return {
    get value() {
      return opts.value();
    },
    get min() {
      return opts.min();
    },
    get max() {
      return opts.max();
    },
    get step() {
      return opts.step();
    },
    get orientation() {
      return opts.orientation();
    },
    get disabled() {
      return opts.disabled();
    },
    get isRange() {
      return isRange();
    },
    get activeThumbIdx() {
      return opts.getActiveThumb();
    },

    setActiveThumbIdx(idx: number) {
      opts.setActiveThumb(idx);
    },

    getThumbValue,
    percentForThumb,
    claimThumbIndex: opts.claimThumbIndex,

    handleThumbKeydown(e: KeyboardEvent, thumbIdx: number) {
      if (opts.disabled()) return;
      const current = getThumbValue(thumbIdx);
      const step = opts.step();

      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowUp':
          e.preventDefault();
          updateThumb(thumbIdx, current + step);
          break;
        case 'ArrowLeft':
        case 'ArrowDown':
          e.preventDefault();
          updateThumb(thumbIdx, current - step);
          break;
        case 'PageUp':
          e.preventDefault();
          updateThumb(thumbIdx, current + step * 10);
          break;
        case 'PageDown':
          e.preventDefault();
          updateThumb(thumbIdx, current - step * 10);
          break;
        case 'Home':
          e.preventDefault();
          updateThumb(thumbIdx, opts.min());
          break;
        case 'End':
          e.preventDefault();
          updateThumb(thumbIdx, opts.max());
          break;
      }
    },

    handleTrackPointerDown(e: PointerEvent, trackEl: HTMLElement) {
      if (opts.disabled()) return;
      const rect = trackEl.getBoundingClientRect();
      const orientation = opts.orientation();
      const min = opts.min();
      const max = opts.max();

      // Compute position as a fraction [0,1]; vertical: bottom=min, top=max
      const fraction =
        orientation === 'horizontal'
          ? (e.clientX - rect.left) / rect.width
          : 1 - (e.clientY - rect.top) / rect.height;

      const rawVal = min + clamp(fraction, 0, 1) * (max - min);

      if (isRange()) {
        const val = opts.value() as [number, number];
        const d0 = Math.abs(rawVal - val[0]);
        const d1 = Math.abs(rawVal - val[1]);
        const thumbIdx = d0 <= d1 ? 0 : 1;
        opts.setActiveThumb(thumbIdx);
        updateThumb(thumbIdx, rawVal);
      } else {
        updateThumb(0, rawVal);
      }
    },
  };
}
