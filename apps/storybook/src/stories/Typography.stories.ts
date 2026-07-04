import type { Meta, StoryObj } from '@storybook/svelte-vite';
// The story `component` is a showcase wrapper (TokensTypographyDemo.svelte): it
// renders the named type scale via the tailwind-preset component classes and labels
// each with its typography-token metrics — a static gallery, not a component
// playground (no controls). It imports ONLY @salt/ui-components (Rule 7); see
// Button.stories.ts for why Svelte CSF is not used under Vite 8.
import TokensTypographyDemo from './_wrappers/TokensTypographyDemo.svelte';

const meta = {
  title: 'Tokens/Typography',
  component: TokensTypographyDemo,
} satisfies Meta<typeof TokensTypographyDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// The named type scale: display, h1, h2, body-lg, body-md, label-caps.
export const Default: Story = {};
