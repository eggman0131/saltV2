// spec: SPEC.md §6 v0.2.3
// Non-interactive primitive — 'events contract' and 'keyboard interaction' blocks omitted per §6.1.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { axe } from 'vitest-axe';
import { createRawSnippet } from 'svelte';
import Heading from '../src/primitives/Heading/Heading.svelte';

afterEach(() => cleanup());

function snippet(text: string) {
  return createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));
}

describe('Heading', () => {
  describe('renders with minimum required props', () => {
    it('renders h2 by default', () => {
      const { container } = render(Heading, { props: { children: snippet('Title') } });
      expect(container.querySelector('h2')).toBeInTheDocument();
    });
  });

  describe('props contract', () => {
    it('renders h1 when level=1', () => {
      const { container } = render(Heading, { props: { level: 1, children: snippet('Title') } });
      expect(container.querySelector('h1')).toBeInTheDocument();
    });
    it('renders h3 when level=3', () => {
      const { container } = render(Heading, { props: { level: 3, children: snippet('Title') } });
      expect(container.querySelector('h3')).toBeInTheDocument();
    });
    it('renders h6 when level=6', () => {
      const { container } = render(Heading, { props: { level: 6, children: snippet('Title') } });
      expect(container.querySelector('h6')).toBeInTheDocument();
    });
    it('applies base classes', () => {
      const { container } = render(Heading, { props: { children: snippet('Title') } });
      expect(container.querySelector('h2')).toHaveClass(
        'font-display',
        'font-semibold',
        'tracking-tight',
        'text-foreground',
      );
    });
    it('maps level 1 to the Salt display token', () => {
      const { container } = render(Heading, { props: { level: 1, children: snippet('Title') } });
      expect(container.querySelector('h1')).toHaveClass('text-display');
    });
    it('maps level 2 to the Salt h1 token', () => {
      const { container } = render(Heading, { props: { level: 2, children: snippet('Title') } });
      expect(container.querySelector('h2')).toHaveClass('text-h1');
    });
    it('maps level 3 to the Salt h2 token', () => {
      const { container } = render(Heading, { props: { level: 3, children: snippet('Title') } });
      expect(container.querySelector('h3')).toHaveClass('text-h2');
    });
    it('maps level 6 to the Salt label-caps token', () => {
      const { container } = render(Heading, { props: { level: 6, children: snippet('Title') } });
      expect(container.querySelector('h6')).toHaveClass('text-label-caps');
    });
    it('merges class prop', () => {
      const { container } = render(Heading, {
        props: { class: 'custom-class', children: snippet('Title') },
      });
      expect(container.querySelector('h2')).toHaveClass('custom-class');
    });
  });

  describe('accessibility', () => {
    it('has no axe violations', async () => {
      const { container } = render(Heading, { props: { children: snippet('Hello') } });
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
