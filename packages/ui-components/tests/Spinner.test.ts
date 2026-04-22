// spec: SPEC.md §6 v0.2.3
// Non-interactive primitive — 'events contract' and 'keyboard interaction' blocks omitted per §6.1.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import { axe } from 'vitest-axe';
import Spinner from '../src/primitives/Spinner/Spinner.svelte';

afterEach(() => cleanup());

describe('Spinner', () => {
  describe('renders with minimum required props', () => {
    it('renders with default props', () => {
      render(Spinner);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  describe('props contract', () => {
    it('renders SVG with aria-hidden', () => {
      const { container } = render(Spinner);
      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    });
    it('applies custom size to SVG', () => {
      const { container } = render(Spinner, { props: { size: 24 } });
      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('width', '24');
      expect(svg).toHaveAttribute('height', '24');
    });
    it('uses default ariaLabel "Loading"', () => {
      render(Spinner);
      expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Loading');
    });
    it('accepts custom ariaLabel', () => {
      render(Spinner, { props: { ariaLabel: 'Saving' } });
      expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Saving');
    });
    it('merges class prop', () => {
      render(Spinner, { props: { class: 'custom-class' } });
      expect(screen.getByRole('status')).toHaveClass('custom-class');
    });
    it('SVG has animate-spin class', () => {
      const { container } = render(Spinner);
      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('animate-spin');
    });
  });

  describe('accessibility', () => {
    it('has no axe violations', async () => {
      const { container } = render(Spinner);
      expect(await axe(container)).toHaveNoViolations();
    });
    it('has role="status"', () => {
      render(Spinner);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });
});
