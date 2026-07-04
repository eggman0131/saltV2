import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { createRawSnippet } from 'svelte';
// Rule 7: primitives are consumed ONLY through @salt/ui-components.
import { Text } from '@salt/ui-components';

// Standard CSF3 (.stories.ts) — see Button.stories.ts. Text's body is a
// `children` snippet built with createRawSnippet (Svelte 5).
const content = (text: string) =>
  createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));

const SAMPLE = 'The whole family shares one shopping list, recipes, and meal plan.';

const meta = {
  title: 'Primitives/Text',
  component: Text,
  args: {
    as: 'p',
    size: 'md',
    muted: false,
    children: content(SAMPLE),
  },
  argTypes: {
    as: { control: 'select', options: ['p', 'span', 'div'] },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    muted: { control: 'boolean' },
    class: { control: 'text' },
    children: { table: { disable: true } },
  },
} satisfies Meta<typeof Text>;

export default meta;
type Story = StoryObj<typeof meta>;

// Live playground: the Controls panel drives size / muted / element.
export const Playground: Story = {};

// Sizes.
export const Small: Story = { args: { size: 'sm', children: content(`Small — ${SAMPLE}`) } };
export const Medium: Story = { args: { size: 'md', children: content(`Medium — ${SAMPLE}`) } };
export const Large: Story = { args: { size: 'lg', children: content(`Large — ${SAMPLE}`) } };

// Muted (secondary) text.
export const Muted: Story = { args: { muted: true, children: content(`Muted — ${SAMPLE}`) } };

// Rendered element.
export const AsSpan: Story = { args: { as: 'span', children: content('Rendered as a <span>') } };
export const AsDiv: Story = { args: { as: 'div', children: content('Rendered as a <div>') } };
