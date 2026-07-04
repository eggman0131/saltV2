import type { Meta, StoryObj } from '@storybook/svelte-vite';
// The story `component` is a showcase wrapper (TokensScalesDemo.svelte): it reads the
// radius / elevation / motion / z-index token groups from @salt/ui-components/tokens
// and renders labelled visual samples — a static gallery, not a component playground
// (no controls). It imports ONLY @salt/ui-components (Rule 7); see Button.stories.ts
// for why Svelte CSF is not used under Vite 8.
import TokensScalesDemo from './_wrappers/TokensScalesDemo.svelte';

const meta = {
  title: 'Tokens/Scales',
  component: TokensScalesDemo,
} satisfies Meta<typeof TokensScalesDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// Radius, elevation, spacing, motion (durations + easings) and z-index scales.
export const Default: Story = {};
