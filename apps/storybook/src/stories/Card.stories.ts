import type { Meta, StoryObj } from '@storybook/svelte-vite';
// The story `component` is a tiny composition wrapper (CardDemo.svelte) because
// Card is a compound component (Card + CardHeader/CardTitle/CardDescription/
// CardContent/CardFooter) that a single `component` + `args` cannot express.
// CardDemo imports ONLY @salt/ui-components (Rule 7); see Button.stories.ts for
// why Svelte CSF is not used under Vite 8.
import CardDemo from './_wrappers/CardDemo.svelte';

const meta = {
  title: 'Primitives/Card',
  component: CardDemo,
  args: {
    title: 'Weeknight pasta',
    description: 'A quick family favourite',
    content: 'Ready in 20 minutes with pantry staples the whole family will eat.',
    footerText: 'Save recipe',
    withFooter: false,
  },
  argTypes: {
    title: { control: 'text' },
    description: { control: 'text' },
    content: { control: 'text' },
    footerText: { control: 'text' },
    withFooter: { control: 'boolean' },
  },
} satisfies Meta<typeof CardDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// Header + title + description + content, no footer.
export const Basic: Story = { args: { withFooter: false } };

// Adds a CardFooter with an action button.
export const WithFooter: Story = { args: { withFooter: true } };
