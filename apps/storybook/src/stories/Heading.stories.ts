import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { createRawSnippet } from 'svelte';
// Rule 7: primitives are consumed ONLY through @salt/ui-components.
import { Heading } from '@salt/ui-components';

// Standard CSF3 (.stories.ts) — see Button.stories.ts for why Svelte CSF is not
// used under Vite 8. Heading's text is a `children` snippet; createRawSnippet
// (Svelte 5) builds that snippet from a plain .ts story.
const content = (text: string) =>
  createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));

const meta = {
  title: 'Primitives/Heading',
  component: Heading,
  args: {
    level: 2,
    children: content('The quick brown fox'),
  },
  argTypes: {
    level: { control: { type: 'select' }, options: [1, 2, 3, 4, 5, 6] },
    class: { control: 'text' },
    // The text snippet is not a user-facing control.
    children: { table: { disable: true } },
  },
} satisfies Meta<typeof Heading>;

export default meta;
type Story = StoryObj<typeof meta>;

// Live playground: the Controls panel drives the heading level.
export const Playground: Story = {};

export const Level1: Story = { args: { level: 1, children: content('Heading level 1') } };
export const Level2: Story = { args: { level: 2, children: content('Heading level 2') } };
export const Level3: Story = { args: { level: 3, children: content('Heading level 3') } };
export const Level4: Story = { args: { level: 4, children: content('Heading level 4') } };
export const Level5: Story = { args: { level: 5, children: content('Heading level 5') } };
export const Level6: Story = { args: { level: 6, children: content('Heading level 6') } };
