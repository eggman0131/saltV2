// spec: SPEC.md §6 v0.2.3
// Non-interactive primitive — 'events contract' and 'keyboard interaction' blocks omitted per §6.1.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { axe } from 'vitest-axe';
import { createRawSnippet } from 'svelte';
import Text from '../src/primitives/Text/Text.svelte';

afterEach(() => cleanup());

function snippet(text: string) {
  return createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));
}

describe('Text', () => {
  describe('renders with minimum required props', () => {
    it('renders a <p> by default', () => {
      const { container } = render(Text, { props: { children: snippet('Hello') } });
      expect(container.querySelector('p')).toBeInTheDocument();
    });
  });

  describe('props contract', () => {
    it('renders <span> when as="span"', () => {
      const { container } = render(Text, { props: { as: 'span', children: snippet('Hello') } });
      expect(container.querySelector('span')).toBeInTheDocument();
    });
    it('renders <div> when as="div"', () => {
      const { container } = render(Text, { props: { as: 'div', children: snippet('Hello') } });
      expect(container.querySelector('div')).toBeInTheDocument();
    });
    it('applies text-sm for size="sm"', () => {
      const { container } = render(Text, { props: { size: 'sm', children: snippet('x') } });
      expect(container.querySelector('p')).toHaveClass('text-sm');
    });
    it('applies text-base for size="md" (default)', () => {
      const { container } = render(Text, { props: { children: snippet('x') } });
      expect(container.querySelector('p')).toHaveClass('text-base');
    });
    it('applies text-lg for size="lg"', () => {
      const { container } = render(Text, { props: { size: 'lg', children: snippet('x') } });
      expect(container.querySelector('p')).toHaveClass('text-lg');
    });
    it('applies text-foreground by default (muted=false)', () => {
      const { container } = render(Text, { props: { children: snippet('x') } });
      expect(container.querySelector('p')).toHaveClass('text-foreground');
    });
    it('applies text-muted-foreground when muted=true', () => {
      const { container } = render(Text, { props: { muted: true, children: snippet('x') } });
      expect(container.querySelector('p')).toHaveClass('text-muted-foreground');
    });
    it('merges class prop', () => {
      const { container } = render(Text, {
        props: { class: 'custom-class', children: snippet('x') },
      });
      expect(container.querySelector('p')).toHaveClass('custom-class');
    });
  });

  describe('accessibility', () => {
    it('has no axe violations', async () => {
      const { container } = render(Text, { props: { children: snippet('Hello world') } });
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
