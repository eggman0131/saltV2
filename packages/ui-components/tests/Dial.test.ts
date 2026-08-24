// spec: ui-spec-v08.md §8.22 v0.8
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import { axe } from 'vitest-axe';
import Dial from '../src/primitives/Dial/Dial.svelte';

afterEach(() => cleanup());

// The sweep is a stroke-dashoffset over a circle of r=22, so a full ring is
// 2πr and an empty one is 0 drawn — i.e. offset === circumference.
const CIRCUMFERENCE = 2 * Math.PI * 22;

function sweep(): SVGCircleElement {
  const el = document.querySelector('.salt-dial__sweep');
  if (!el) throw new Error('no sweep drawn');
  return el as SVGCircleElement;
}

function offset(): number {
  return Number(sweep().getAttribute('stroke-dashoffset'));
}

describe('Dial', () => {
  describe('geometry', () => {
    it('draws nothing at 0', () => {
      render(Dial, { props: { value: 0, ariaLabel: 'Empty' } });
      expect(offset()).toBeCloseTo(CIRCUMFERENCE, 3);
    });

    it('closes the ring at 1', () => {
      render(Dial, { props: { value: 1, ariaLabel: 'Full' } });
      expect(offset()).toBeCloseTo(0, 3);
    });

    it('draws half the ring at 0.5', () => {
      render(Dial, { props: { value: 0.5, ariaLabel: 'Half' } });
      expect(offset()).toBeCloseTo(CIRCUMFERENCE / 2, 3);
    });

    it('starts the sweep at twelve o’clock, leaving the track unrotated', () => {
      render(Dial, { props: { value: 0.5, ariaLabel: 'Half' } });
      expect(sweep().getAttribute('transform')).toBe('rotate(-90 26 26)');
      expect(document.querySelector('.salt-dial__track')?.getAttribute('transform')).toBeNull();
    });
  });

  describe('clamping', () => {
    // A ring is a closed shape with nowhere to put an out-of-range value, and the
    // producer is a clock — an overrun timer yields a negative fraction.
    it('saturates rather than overdrawing past 1', () => {
      render(Dial, { props: { value: 4.5, ariaLabel: 'Over' } });
      expect(offset()).toBeCloseTo(0, 3);
    });

    it('floors a negative fraction at empty', () => {
      render(Dial, { props: { value: -2, ariaLabel: 'Under' } });
      expect(offset()).toBeCloseTo(CIRCUMFERENCE, 3);
    });

    it('treats a non-finite value as empty rather than drawing NaN', () => {
      render(Dial, { props: { value: Number.NaN, ariaLabel: 'Broken' } });
      expect(offset()).toBeCloseTo(CIRCUMFERENCE, 3);
    });

    it('defaults to empty when no value is given', () => {
      render(Dial, { props: { ariaLabel: 'Default' } });
      expect(offset()).toBeCloseTo(CIRCUMFERENCE, 3);
    });
  });

  describe('variants', () => {
    it('defaults to md and neutral', () => {
      render(Dial, { props: { value: 0.5, ariaLabel: 'D' } });
      const svg = document.querySelector('.salt-dial');
      expect(svg?.classList.contains('salt-dial--md')).toBe(true);
      expect(svg?.classList.contains('salt-dial--neutral')).toBe(true);
    });

    it('takes the heat tone, which reads its colour from an ancestor', () => {
      render(Dial, { props: { value: 0.5, tone: 'heat', size: 'sm', ariaLabel: 'D' } });
      const svg = document.querySelector('.salt-dial');
      expect(svg?.classList.contains('salt-dial--heat')).toBe(true);
      expect(svg?.classList.contains('salt-dial--sm')).toBe(true);
    });

    it('merges a caller class last', () => {
      render(Dial, { props: { value: 0.5, ariaLabel: 'D', class: 'mt-4' } });
      expect(document.querySelector('.salt-dial-wrap')?.classList.contains('mt-4')).toBe(true);
    });
  });

  describe('label', () => {
    it('renders nothing in the middle when given no children', () => {
      render(Dial, { props: { value: 0.5, ariaLabel: 'D' } });
      expect(document.querySelector('.salt-dial__label')).toBeNull();
    });
  });

  describe('accessibility', () => {
    it('names itself when given a label', () => {
      render(Dial, { props: { value: 0.5, ariaLabel: '4 minutes left' } });
      expect(screen.getByRole('img', { name: '4 minutes left' })).toBeInTheDocument();
    });

    it('hides itself entirely when the label is explicitly null', () => {
      // The common case on a card: the clock inside the ring is visible text and
      // is announced on its own, so a second announcement would be a duplicate.
      render(Dial, { props: { value: 0.5, ariaLabel: null } });
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
      expect(document.querySelector('.salt-dial')?.getAttribute('aria-hidden')).toBe('true');
    });

    it('has no axe violations', async () => {
      const { container } = render(Dial, { props: { value: 0.5, ariaLabel: 'Progress' } });
      expect(await axe(container)).toHaveNoViolations();
    });

    it('has no axe violations when decorative', async () => {
      const { container } = render(Dial, { props: { value: 0.5, ariaLabel: null } });
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
