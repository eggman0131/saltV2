// spec: SPEC.md §6 v0.2.3
// Non-interactive primitives — 'events contract' and 'keyboard interaction' blocks omitted per §6.1.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { axe } from 'vitest-axe';
import { createRawSnippet } from 'svelte';
import Stack from '../src/primitives/Stack/Stack.svelte';
import Inline from '../src/primitives/Inline/Inline.svelte';
import Grid from '../src/primitives/Grid/Grid.svelte';
import Divider from '../src/primitives/Divider/Divider.svelte';

afterEach(() => cleanup());

function snippet(text: string) {
  return createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));
}

describe('Stack', () => {
  describe('renders with minimum required props', () => {
    it('renders a div', () => {
      const { container } = render(Stack);
      expect(container.querySelector('div')).toBeInTheDocument();
    });
  });

  describe('props contract', () => {
    it('applies flex flex-col base classes', () => {
      const { container } = render(Stack);
      expect(container.firstElementChild).toHaveClass('flex', 'flex-col');
    });
    it('applies default gap-4', () => {
      const { container } = render(Stack);
      expect(container.firstElementChild).toHaveClass('gap-4');
    });
    it('applies gap-2 when gap="2"', () => {
      const { container } = render(Stack, { props: { gap: '2' } });
      expect(container.firstElementChild).toHaveClass('gap-2');
    });
    it('applies items-center when align="center"', () => {
      const { container } = render(Stack, { props: { align: 'center' } });
      expect(container.firstElementChild).toHaveClass('items-center');
    });
    it('applies justify-between when justify="between"', () => {
      const { container } = render(Stack, { props: { justify: 'between' } });
      expect(container.firstElementChild).toHaveClass('justify-between');
    });
    it('merges class prop', () => {
      const { container } = render(Stack, { props: { class: 'custom-class' } });
      expect(container.firstElementChild).toHaveClass('custom-class');
    });
    it('renders children', () => {
      const { container } = render(Stack, { props: { children: snippet('item') } });
      expect(container).toHaveTextContent('item');
    });
  });

  describe('accessibility', () => {
    it('has no axe violations', async () => {
      const { container } = render(Stack, { props: { children: snippet('content') } });
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});

describe('Inline', () => {
  describe('renders with minimum required props', () => {
    it('renders a div with flex flex-row', () => {
      const { container } = render(Inline);
      expect(container.firstElementChild).toHaveClass('flex', 'flex-row');
    });
  });

  describe('props contract', () => {
    it('applies gap-4 by default', () => {
      const { container } = render(Inline);
      expect(container.firstElementChild).toHaveClass('gap-4');
    });
    it('applies gap-2 when gap="2"', () => {
      const { container } = render(Inline, { props: { gap: '2' } });
      expect(container.firstElementChild).toHaveClass('gap-2');
    });
    it('applies items-center when align="center"', () => {
      const { container } = render(Inline, { props: { align: 'center' } });
      expect(container.firstElementChild).toHaveClass('items-center');
    });
    it('merges class prop', () => {
      const { container } = render(Inline, { props: { class: 'my-class' } });
      expect(container.firstElementChild).toHaveClass('my-class');
    });
  });

  describe('accessibility', () => {
    it('has no axe violations', async () => {
      const { container } = render(Inline);
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});

describe('Grid', () => {
  describe('renders with minimum required props', () => {
    it('renders a div with grid class', () => {
      const { container } = render(Grid);
      expect(container.firstElementChild).toHaveClass('grid');
    });
  });

  describe('props contract', () => {
    it('applies grid-cols-2 by default', () => {
      const { container } = render(Grid);
      expect(container.firstElementChild).toHaveClass('grid-cols-2');
    });
    it('applies grid-cols-3 when cols=3', () => {
      const { container } = render(Grid, { props: { cols: 3 } });
      expect(container.firstElementChild).toHaveClass('grid-cols-3');
    });
    it('applies gap-4 by default', () => {
      const { container } = render(Grid);
      expect(container.firstElementChild).toHaveClass('gap-4');
    });
    it('applies gap-2 when gap="2"', () => {
      const { container } = render(Grid, { props: { gap: '2' } });
      expect(container.firstElementChild).toHaveClass('gap-2');
    });
    it('merges class prop', () => {
      const { container } = render(Grid, { props: { class: 'my-grid' } });
      expect(container.firstElementChild).toHaveClass('my-grid');
    });
  });

  describe('accessibility', () => {
    it('has no axe violations', async () => {
      const { container } = render(Grid, { props: { children: snippet('cell') } });
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});

describe('Divider', () => {
  describe('renders with minimum required props', () => {
    it('renders with role="separator"', () => {
      const { container } = render(Divider);
      expect(container.querySelector('[role="separator"]')).toBeInTheDocument();
    });
  });

  describe('props contract', () => {
    it('applies horizontal styles by default', () => {
      const { container } = render(Divider);
      expect(container.firstElementChild).toHaveClass('h-px', 'w-full', 'bg-border');
    });
    it('applies vertical styles when orientation="vertical"', () => {
      const { container } = render(Divider, { props: { orientation: 'vertical' } });
      expect(container.firstElementChild).toHaveClass('w-px', 'h-full', 'bg-border');
    });
    it('sets aria-orientation attribute', () => {
      const { container } = render(Divider, { props: { orientation: 'vertical' } });
      expect(container.firstElementChild).toHaveAttribute('aria-orientation', 'vertical');
    });
    it('merges class prop', () => {
      const { container } = render(Divider, { props: { class: 'my-divider' } });
      expect(container.firstElementChild).toHaveClass('my-divider');
    });
  });

  describe('accessibility', () => {
    it('has no axe violations (horizontal)', async () => {
      const { container } = render(Divider);
      expect(await axe(container)).toHaveNoViolations();
    });
    it('has no axe violations (vertical)', async () => {
      const { container } = render(Divider, { props: { orientation: 'vertical' } });
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
