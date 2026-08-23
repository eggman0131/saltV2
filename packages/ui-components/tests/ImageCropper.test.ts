// spec: ui-spec-v04 §15 (ImageCropper), ui-spec-v06 §1 (free-aspect mode),
// ui-spec-v11 §1 (square mode)
// The aspect contract only — v0.4 §15.6's canvas-pipeline requirements need a
// real image decode and a real 2D context, neither of which jsdom provides.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/svelte';
import ImageCropper from '../src/primitives/ImageCropper/ImageCropper.svelte';

// jsdom never fetches or decodes an image, so `new Image()` would leave a
// free-mode measurement pending forever. Stand in a class that resolves the
// dimensions encoded in the `src` (`test:<w>x<h>`), so a story-shaped portrait
// source can be measured deterministically. Anything else never loads — which is
// itself the "measurement in flight / failed" case (ui-spec-v06 §1.4).
const PORTRAIT = 'test:900x1200';
const LANDSCAPE = 'test:1600x900';
const NEVER_LOADS = 'blob:pending';

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  #src = '';
  get src(): string {
    return this.#src;
  }
  set src(value: string) {
    this.#src = value;
    const match = /^test:(\d+)x(\d+)$/.exec(value);
    if (!match) return;
    this.naturalWidth = Number(match[1]);
    this.naturalHeight = Number(match[2]);
    queueMicrotask(() => this.onload?.());
  }
}

beforeEach(() => {
  vi.stubGlobal('Image', FakeImage);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const stageOf = (getByTestId: (id: string) => HTMLElement) => getByTestId('image-cropper-stage');

// jsdom normalises `aspect-ratio: 1.5` to `1.5 / 1`, so compare the ratio itself
// rather than the serialised string. `null` = no ratio set (placeholder stage).
function stageRatio(stage: HTMLElement): number | null {
  const raw = stage.style.aspectRatio;
  if (!raw) return null;
  const [width, height = '1'] = raw.split('/').map((part) => part.trim());
  return Number(width) / Number(height);
}

describe('ImageCropper', () => {
  describe('aspect: 3:2 (default)', () => {
    it('renders the stage at 3:2 when no aspect is passed', () => {
      const { getByTestId } = render(ImageCropper, { props: { src: PORTRAIT } });
      expect(stageRatio(stageOf(getByTestId))).toBeCloseTo(3 / 2);
    });

    it('is identical when 3:2 is passed explicitly', () => {
      const { getByTestId } = render(ImageCropper, {
        props: { src: PORTRAIT, aspect: '3:2' as const },
      });
      expect(stageRatio(stageOf(getByTestId))).toBeCloseTo(3 / 2);
    });

    it('does not wait on a measurement — the stage is framed from the first render', () => {
      const { getByTestId } = render(ImageCropper, { props: { src: NEVER_LOADS } });
      expect(stageRatio(stageOf(getByTestId))).toBeCloseTo(3 / 2);
    });
  });

  describe('aspect: free', () => {
    it('renders no 3:2 stage and no cropper while the source is unmeasured', () => {
      const { getByTestId, container } = render(ImageCropper, {
        props: { src: NEVER_LOADS, aspect: 'free' as const },
      });
      const stage = stageOf(getByTestId);
      expect(stageRatio(stage)).toBeNull();
      expect(stage.className).not.toContain('aspect-');
      // svelte-easy-crop is not mounted: the placeholder stage is empty.
      expect(stage.children).toHaveLength(0);
      // The rest of the primitive still renders.
      expect(container.querySelector('[data-testid="image-cropper-zoom"]')).not.toBeNull();
    });

    it('takes the source portrait ratio once measured', async () => {
      const { getByTestId } = render(ImageCropper, {
        props: { src: PORTRAIT, aspect: 'free' as const },
      });
      await waitFor(() => {
        expect(stageRatio(stageOf(getByTestId))).toBeCloseTo(900 / 1200);
      });
      expect(stageOf(getByTestId).children.length).toBeGreaterThan(0);
    });

    it('takes the source landscape ratio too — free is the image, not portrait', async () => {
      const { getByTestId } = render(ImageCropper, {
        props: { src: LANDSCAPE, aspect: 'free' as const },
      });
      await waitFor(() => {
        expect(stageRatio(stageOf(getByTestId))).toBeCloseTo(1600 / 900);
      });
    });
  });

  // ui-spec-v11 §1.6. The point of the mode is that it is a CONSTANT: unlike
  // 'free' it measures nothing, so a source jsdom can never load still mounts a
  // cropper at 1:1 rather than sitting on a placeholder.
  describe('aspect: 1:1 (ui-spec-v11 §1)', () => {
    it('renders the stage at 1:1', () => {
      const { getByTestId } = render(ImageCropper, {
        props: { src: PORTRAIT, aspect: '1:1' as const },
      });
      expect(stageRatio(stageOf(getByTestId))).toBeCloseTo(1);
    });

    it('mounts the cropper immediately, with no measurement and no placeholder', () => {
      const { getByTestId } = render(ImageCropper, {
        props: { src: NEVER_LOADS, aspect: '1:1' as const },
      });
      expect(stageRatio(stageOf(getByTestId))).toBeCloseTo(1);
      expect(stageOf(getByTestId).children.length).toBeGreaterThan(0);
    });

    it('leaves the other two modes alone', () => {
      const square = render(ImageCropper, {
        props: { src: LANDSCAPE, aspect: '1:1' as const },
      });
      expect(stageRatio(stageOf(square.getByTestId))).toBeCloseTo(1);
      cleanup();
      const hero = render(ImageCropper, { props: { src: LANDSCAPE } });
      expect(stageRatio(stageOf(hero.getByTestId))).toBeCloseTo(3 / 2);
    });

    it('renders the zoom slider', () => {
      const { getByTestId } = render(ImageCropper, {
        props: { src: PORTRAIT, aspect: '1:1' as const },
      });
      expect(getByTestId('image-cropper-zoom')).toHaveAttribute('aria-label', 'Zoom');
    });
  });

  it('merges the class prop onto the outer wrapper', () => {
    const { container } = render(ImageCropper, {
      props: { src: PORTRAIT, class: 'mt-6' },
    });
    expect(container.querySelector('.mt-6')).not.toBeNull();
  });

  it('renders the zoom slider with its accessible name in both modes', () => {
    const locked = render(ImageCropper, { props: { src: PORTRAIT } });
    expect(locked.getByTestId('image-cropper-zoom')).toHaveAttribute('aria-label', 'Zoom');
    cleanup();
    const free = render(ImageCropper, { props: { src: PORTRAIT, aspect: 'free' as const } });
    expect(free.getByTestId('image-cropper-zoom')).toHaveAttribute('aria-label', 'Zoom');
  });
});
