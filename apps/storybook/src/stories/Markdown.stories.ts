import type { Meta, StoryObj } from '@storybook/svelte-vite';
// Rule 7: primitives are consumed ONLY through @salt/ui-components.
import { Markdown } from '@salt/ui-components';

// Standard CSF3 (.stories.ts) — see Button.stories.ts. `text` is a plain string
// prop, so no wrapper/snippet is needed. Assembled line-by-line (single-quoted
// entries) so fenced-code backticks need no escaping.
const RICH = [
  '# Weeknight dinner',
  '',
  'A **quick** and _easy_ recipe, with a [link to the source](https://example.com).',
  '',
  '## Ingredients',
  '',
  '- 200g pasta',
  '- 2 cloves garlic',
  '- Olive oil',
  '',
  '## Steps',
  '',
  '1. Boil the pasta until al dente.',
  '2. Gently sauté the garlic.',
  '',
  'Season with `salt` to taste, or call `cook()` inline.',
  '',
  '```js',
  'const dinner = cook({ pasta: true, garlic: 2 });',
  '```',
  '',
  '> Tip: reserve a cup of pasta water before draining.',
  '',
  '| Ingredient | Quantity |',
  '| ---------- | -------- |',
  '| Pasta      | 200g     |',
  '| Garlic     | 2 cloves |',
].join('\n');

const meta = {
  title: 'Primitives/Markdown',
  component: Markdown,
  args: {
    text: RICH,
  },
  argTypes: {
    text: { control: 'text' },
    class: { control: 'text' },
  },
} satisfies Meta<typeof Markdown>;

export default meta;
type Story = StoryObj<typeof meta>;

// Live playground: edit the markdown source in the Controls panel.
export const Playground: Story = {};

// Rich content: headings, list, ordered list, inline + fenced code, blockquote,
// table, and a link.
export const RichContent: Story = { args: { text: RICH } };

// A short, single-paragraph fragment.
export const Simple: Story = {
  args: { text: 'Just a **short** paragraph with a bit of `code` and _emphasis_.' },
};
