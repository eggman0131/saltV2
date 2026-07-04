import type { Meta, StoryObj } from '@storybook/svelte-vite';
// The story `component` is a composition wrapper (DetailPageDemo.svelte): DetailPage
// has optional actions/metadata Snippet slots and an onBack handler that a single
// `component` + `args` cannot express, and the optionals must be conditionally
// spread (never forwarded as `undefined`) under exactOptionalPropertyTypes. The
// wrapper imports ONLY @salt/ui-components (Rule 7); see Button.stories.ts for why
// Svelte CSF is not used under Vite 8.
import DetailPageDemo from './_wrappers/DetailPageDemo.svelte';

const meta = {
  title: 'Templates/DetailPage',
  component: DetailPageDemo,
  args: {
    title: 'Weeknight pasta',
    subtitle: 'Dinner · 20 minutes · Serves 4',
    withActions: false,
    withMetadata: false,
    withBack: false,
  },
  argTypes: {
    title: { control: 'text' },
    subtitle: { control: 'text' },
    withActions: { control: 'boolean' },
    withMetadata: { control: 'boolean' },
    withBack: { control: 'boolean' },
  },
} satisfies Meta<typeof DetailPageDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// Title, subtitle, and a body paragraph (default children snippet).
export const Default: Story = {};

// Header action buttons via the `actions` snippet (Edit / Cook).
export const WithActions: Story = { args: { withActions: true } };

// Sidebar metadata via the `metadata` snippet — switches to a two-column layout.
export const WithMetadata: Story = { args: { withMetadata: true } };

// A back button rendered when `onBack` is supplied.
export const WithBack: Story = { args: { withBack: true } };
