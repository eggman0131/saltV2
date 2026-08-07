// spec: ui-spec-v04.md §12
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import Markdown from '../src/primitives/Markdown/Markdown.svelte';

afterEach(() => cleanup());

describe('Markdown', () => {
  describe('renders with minimum required props', () => {
    it('renders plain text', () => {
      const { container } = render(Markdown, { props: { text: 'Just a note.' } });
      expect(container.textContent).toContain('Just a note.');
    });

    it('renders Markdown syntax as elements, not literal characters', () => {
      const { container } = render(Markdown, {
        props: { text: '**bold** and *italic*\n\n- one\n- two' },
      });
      expect(container.querySelector('strong')?.textContent).toBe('bold');
      expect(container.querySelector('em')?.textContent).toBe('italic');
      expect(container.querySelectorAll('li')).toHaveLength(2);
      expect(container.textContent).not.toContain('**');
    });
  });

  describe('props contract', () => {
    it('merges the class prop onto the salt-md wrapper', () => {
      const { container } = render(Markdown, {
        props: { text: 'x', class: 'text-sm text-muted-foreground' },
      });
      const wrapper = container.querySelector('.salt-md');
      expect(wrapper).toHaveClass('text-sm', 'text-muted-foreground');
    });
  });

  // The whole point of `breaks` is that turning a plain-text field into a
  // Markdown-rendered one is a no-op for text already saved as line-per-thought
  // prose. These assert both halves of §12.3.1: lines stay lines, blank lines
  // stay paragraphs.
  describe('breaks', () => {
    it('folds a single newline into one paragraph when off (default)', () => {
      const { container } = render(Markdown, { props: { text: 'first line\nsecond line' } });
      expect(container.querySelectorAll('br')).toHaveLength(0);
      expect(container.querySelectorAll('p')).toHaveLength(1);
    });

    it('renders a single newline as a hard break when on', () => {
      const { container } = render(Markdown, {
        props: { text: 'first line\nsecond line', breaks: true },
      });
      expect(container.querySelectorAll('br')).toHaveLength(1);
      expect(container.querySelectorAll('p')).toHaveLength(1);
      expect(container.textContent).toContain('first line');
      expect(container.textContent).toContain('second line');
    });

    it('keeps a blank line as a paragraph break, not a hard break, when on', () => {
      const { container } = render(Markdown, {
        props: { text: 'first para\n\nsecond para', breaks: true },
      });
      expect(container.querySelectorAll('p')).toHaveLength(2);
      expect(container.querySelectorAll('br')).toHaveLength(0);
    });

    it('normalises CRLF so the hard break lands after the text', () => {
      const { container } = render(Markdown, {
        props: { text: 'first line\r\nsecond line', breaks: true },
      });
      expect(container.querySelectorAll('br')).toHaveLength(1);
      expect(container.textContent).toContain('second line');
    });

    it('leaves Markdown structure intact when on', () => {
      const { container } = render(Markdown, {
        props: { text: 'Watch out:\n- **salt** early\n- rest 10 min', breaks: true },
      });
      expect(container.querySelectorAll('li')).toHaveLength(2);
      expect(container.querySelector('strong')?.textContent).toBe('salt');
    });

    it('does not add stray characters to text with no newlines', () => {
      const { container } = render(Markdown, {
        props: { text: 'single line note', breaks: true },
      });
      expect(container.textContent?.trim()).toBe('single line note');
      expect(container.querySelectorAll('br')).toHaveLength(0);
    });
  });
});
