// spec: SPEC.md §6 v0.2.3
// Non-interactive primitive — 'events contract' and 'keyboard interaction' blocks omitted per §6.1.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { axe } from 'vitest-axe';
import Icon from '../src/primitives/Icon/Icon.svelte';

afterEach(() => cleanup());

describe('Icon', () => {
  describe('renders with minimum required props', () => {
    it('renders an SVG element', () => {
      const { container } = render(Icon, { props: { name: 'Circle' } });
      expect(container.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('props contract', () => {
    it('applies shrink-0 class', () => {
      const { container } = render(Icon, { props: { name: 'Circle' } });
      expect(container.querySelector('svg')).toHaveClass('shrink-0');
    });
    it('sets aria-hidden="true" when no ariaLabel', () => {
      const { container } = render(Icon, { props: { name: 'Circle' } });
      expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    });
    it('sets role="img" when ariaLabel is provided', () => {
      const { container } = render(Icon, { props: { name: 'Circle', ariaLabel: 'Circle icon' } });
      expect(container.querySelector('svg')).toHaveAttribute('role', 'img');
    });
    it('sets aria-label when ariaLabel is provided', () => {
      const { container } = render(Icon, { props: { name: 'Circle', ariaLabel: 'Circle icon' } });
      expect(container.querySelector('svg')).toHaveAttribute('aria-label', 'Circle icon');
    });
    it('does not set aria-hidden when ariaLabel is provided', () => {
      const { container } = render(Icon, { props: { name: 'Circle', ariaLabel: 'icon' } });
      expect(container.querySelector('svg')).not.toHaveAttribute('aria-hidden');
    });
    it('merges class prop', () => {
      const { container } = render(Icon, { props: { name: 'Circle', class: 'custom-class' } });
      expect(container.querySelector('svg')).toHaveClass('custom-class');
    });
  });

  describe('accessibility', () => {
    it('has no axe violations for decorative icon', async () => {
      const { container } = render(Icon, { props: { name: 'Circle' } });
      expect(await axe(container)).toHaveNoViolations();
    });
    it('has no axe violations for labelled icon', async () => {
      const { container } = render(Icon, { props: { name: 'Circle', ariaLabel: 'Circle' } });
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
