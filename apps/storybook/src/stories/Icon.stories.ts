import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { iconNames } from '@salt/ui-components';
// The story `component` is a showcase wrapper (IconDemo.svelte) so a single file
// can offer both the single-icon control (name/size) and the Gallery grid. The
// wrapper imports ONLY @salt/ui-components (Rule 7); see Button.stories.ts for
// why Svelte CSF is not used under Vite 8.
import IconDemo from './_wrappers/IconDemo.svelte';

const meta = {
  title: 'Primitives/Icon',
  component: IconDemo,
  args: {
    name: 'ChefHat',
    size: 24,
    gallery: false,
  },
  argTypes: {
    // Icon.name is `keyof typeof iconRegistry` (issue #813) — the curated set of
    // icons Salt ships. Driving the control off the registry's own keys keeps the
    // options list from drifting and from offering names that would not compile.
    name: { control: 'select', options: iconNames },
    size: { control: { type: 'number', min: 12, max: 96, step: 2 } },
    gallery: { control: 'boolean' },
  },
} satisfies Meta<typeof IconDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// Live playground: pick any registered name and size from the Controls panel.
export const Playground: Story = {};

export const Small: Story = { args: { name: 'Search', size: 16 } };
export const Large: Story = { args: { name: 'Flame', size: 48 } };

// A grid of every registered icon.
export const Gallery: Story = { args: { gallery: true } };
