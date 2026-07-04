import type { Meta, StoryObj } from '@storybook/svelte-vite';
// The story `component` is a composition wrapper (SliderDemo.svelte): Slider is a
// context-driven compound (root + SliderTrack/SliderRange/SliderThumb) whose
// range variant needs two thumbs — a single `component` + `args` cannot express
// it. The wrapper imports ONLY @salt/ui-components (Rule 7); see Button.stories.ts
// for why Svelte CSF is not used under Vite 8.
import SliderDemo from './_wrappers/SliderDemo.svelte';

const meta = {
  title: 'Primitives/Slider',
  component: SliderDemo,
  args: {
    range: false,
    disabled: false,
    orientation: 'horizontal',
    min: 0,
    max: 100,
    step: 1,
  },
  argTypes: {
    range: { control: 'boolean' },
    disabled: { control: 'boolean' },
    orientation: { control: 'radio', options: ['horizontal', 'vertical'] },
    min: { control: { type: 'number' } },
    max: { control: { type: 'number' } },
    step: { control: { type: 'number', min: 1 } },
  },
} satisfies Meta<typeof SliderDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// Single-value slider with one thumb.
export const Single: Story = { args: { range: false } };

// Two thumbs bounding a [min, max] range.
export const Range: Story = { args: { range: true } };

// Disabled.
export const Disabled: Story = { args: { disabled: true } };

// Vertical orientation (rendered inside a fixed-height parent).
export const Vertical: Story = { args: { orientation: 'vertical' } };
