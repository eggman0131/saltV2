import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { createRawSnippet } from 'svelte';
// Rule 7: primitives are consumed ONLY through @salt/ui-components, never
// bits-ui / melt-ui / shadcn-svelte directly.
import { Button } from '@salt/ui-components';

// Standard CSF3 (.stories.ts) — NOT Svelte CSF (.stories.svelte). The
// @storybook/addon-svelte-csf compiler is not yet Vite-8/Rolldown compatible
// (see apps/storybook/.storybook/main.ts + the Phase-1 report). CSF3 renders the
// real component via @storybook/svelte and needs no Svelte-CSF compiler.
//
// Button's label is a Svelte `children` snippet; createRawSnippet (Svelte 5)
// lets us build that snippet from a plain .ts story.
const label = (text: string) => createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));

const meta = {
  title: 'Primitives/Button',
  component: Button,
  args: {
    variant: 'solid',
    size: 'md',
    disabled: false,
    loading: false,
    fullWidth: false,
    children: label('Button'),
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['solid', 'outline', 'ghost', 'link', 'destructive'],
    },
    size: { control: 'select', options: ['sm', 'md', 'lg', 'icon'] },
    disabled: { control: 'boolean' },
    loading: { control: 'boolean' },
    fullWidth: { control: 'boolean' },
    // The label snippet is not a user-facing control.
    children: { table: { disable: true } },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

// Live playground: the Controls panel drives real Button props.
export const Playground: Story = {};

export const Solid: Story = { args: { variant: 'solid', children: label('Solid') } };
export const Outline: Story = { args: { variant: 'outline', children: label('Outline') } };
export const Ghost: Story = { args: { variant: 'ghost', children: label('Ghost') } };
export const Destructive: Story = {
  args: { variant: 'destructive', children: label('Destructive') },
};

export const Loading: Story = { args: { loading: true, children: label('Loading') } };
export const Disabled: Story = { args: { disabled: true, children: label('Disabled') } };
