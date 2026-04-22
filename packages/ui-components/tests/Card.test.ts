// spec: SPEC.md §6 v0.2.3
// Non-interactive primitive — 'events contract' and 'keyboard interaction' blocks omitted per §6.1.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { axe } from 'vitest-axe';
import { createRawSnippet } from 'svelte';
import Card from '../src/primitives/Card/Card.svelte';
import CardHeader from '../src/primitives/Card/CardHeader.svelte';
import CardTitle from '../src/primitives/Card/CardTitle.svelte';
import CardDescription from '../src/primitives/Card/CardDescription.svelte';
import CardContent from '../src/primitives/Card/CardContent.svelte';
import CardFooter from '../src/primitives/Card/CardFooter.svelte';

afterEach(() => cleanup());

function snippet(text: string) {
  return createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));
}

describe('Card', () => {
  describe('renders with minimum required props', () => {
    it('renders a div', () => {
      const { container } = render(Card);
      expect(container.querySelector('div')).toBeInTheDocument();
    });
    it('renders children', () => {
      const { container } = render(Card, { props: { children: snippet('content') } });
      expect(container).toHaveTextContent('content');
    });
  });

  describe('props contract', () => {
    it('applies card base classes', () => {
      const { container } = render(Card);
      expect(container.firstElementChild).toHaveClass(
        'rounded-lg',
        'border',
        'bg-card',
        'shadow-sm',
      );
    });
    it('merges class prop', () => {
      const { container } = render(Card, { props: { class: 'extra-class' } });
      expect(container.firstElementChild).toHaveClass('extra-class');
    });
  });

  describe('accessibility', () => {
    it('Card has no axe violations', async () => {
      const { container } = render(Card, { props: { children: snippet('content') } });
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});

describe('CardHeader', () => {
  describe('renders with minimum required props', () => {
    it('renders a div with header classes', () => {
      const { container } = render(CardHeader);
      expect(container.firstElementChild).toHaveClass('flex', 'flex-col', 'p-6');
    });
  });

  describe('props contract', () => {
    it('merges class prop', () => {
      const { container } = render(CardHeader, { props: { class: 'custom' } });
      expect(container.firstElementChild).toHaveClass('custom');
    });
  });

  describe('accessibility', () => {
    it('has no axe violations', async () => {
      const { container } = render(CardHeader);
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});

describe('CardTitle', () => {
  describe('renders with minimum required props', () => {
    it('renders with title classes', () => {
      const { container } = render(CardTitle, { props: { children: snippet('Title') } });
      expect(container.firstElementChild).toHaveClass('font-semibold');
    });
  });

  describe('props contract', () => {
    it('merges class prop', () => {
      const { container } = render(CardTitle, { props: { class: 'custom' } });
      expect(container.firstElementChild).toHaveClass('custom');
    });
  });

  describe('accessibility', () => {
    it('has no axe violations', async () => {
      const { container } = render(CardTitle, { props: { children: snippet('Title') } });
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});

describe('CardDescription', () => {
  describe('renders with minimum required props', () => {
    it('renders with description classes', () => {
      const { container } = render(CardDescription, { props: { children: snippet('desc') } });
      expect(container.firstElementChild).toHaveClass('text-sm', 'text-muted-foreground');
    });
  });

  describe('accessibility', () => {
    it('has no axe violations', async () => {
      const { container } = render(CardDescription, { props: { children: snippet('desc') } });
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});

describe('CardContent', () => {
  describe('renders with minimum required props', () => {
    it('renders with content classes', () => {
      const { container } = render(CardContent);
      expect(container.firstElementChild).toHaveClass('p-6', 'pt-0');
    });
  });

  describe('accessibility', () => {
    it('has no axe violations', async () => {
      const { container } = render(CardContent);
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});

describe('CardFooter', () => {
  describe('renders with minimum required props', () => {
    it('renders with footer classes', () => {
      const { container } = render(CardFooter);
      expect(container.firstElementChild).toHaveClass('flex', 'items-center', 'p-6', 'pt-0');
    });
  });

  describe('accessibility', () => {
    it('has no axe violations', async () => {
      const { container } = render(CardFooter);
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
