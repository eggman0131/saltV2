import type { Meta, StoryObj } from '@storybook/svelte-vite';
import TabsDemo from './_wrappers/TabsDemo.svelte';

// Standard CSF3 (.stories.ts) — see Button.stories.ts for why Svelte CSF is not
// used under Vite 8. Tabs are exercised through a wrapper because the subject is
// the whole family: a strip, its panels, and a page that owns which one shows.
const meta = {
  title: 'Primitives/Tabs',
  component: TabsDemo,
  args: { ariaLabel: 'Recipe', counts: true },
  argTypes: {
    ariaLabel: { control: 'text' },
    counts: { control: 'boolean' },
  },
} satisfies Meta<typeof TabsDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

// Arrow keys move focus AND selection (roving tabindex, automatic activation —
// ui-spec-v10 §8.28.4). Tab reaches the strip once, then the panel.
export const WithCounts: Story = { args: { counts: true } };

// A count is optional per trigger; without one the strip is plain labels.
export const WithoutCounts: Story = { args: { counts: false } };

// The tablist always has role="tablist"; omitting the name leaves it unnamed,
// which §8.28.6 permits and discourages.
export const Unnamed: Story = { args: { ariaLabel: undefined } };
