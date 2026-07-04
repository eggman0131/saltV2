import type { Meta, StoryObj } from '@storybook/svelte-vite';
// The story `component` is a showcase wrapper (TokensColorsDemo.svelte): it reads the
// semantic colour tokens from @salt/ui-components/tokens and renders swatches +
// role pairings — a static token gallery, not a component playground (no controls).
// It imports ONLY @salt/ui-components (Rule 7); see Button.stories.ts for why Svelte
// CSF is not used under Vite 8.
import TokensColorsDemo from './_wrappers/TokensColorsDemo.svelte';

const meta = {
  title: 'Tokens/Colors',
  component: TokensColorsDemo,
} satisfies Meta<typeof TokensColorsDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// The semantic colour roles and foreground/background pairings.
export const Default: Story = {};
