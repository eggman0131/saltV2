import type { Meta, StoryObj } from '@storybook/svelte-vite';
// The story `component` is a composition wrapper (FormPageDemo.svelte): FormPage
// needs a `children` snippet of fields plus onSubmit/onCancel handlers that a single
// `component` + `args` cannot express. The wrapper imports ONLY @salt/ui-components
// (Rule 7); see Button.stories.ts for why Svelte CSF is not used under Vite 8.
import FormPageDemo from './_wrappers/FormPageDemo.svelte';

const meta = {
  title: 'Templates/FormPage',
  component: FormPageDemo,
  args: {
    title: 'Add recipe',
    description: 'Fill in the details below.',
    submitLabel: 'Save',
    cancelLabel: 'Cancel',
    isSubmitting: false,
    canSubmit: true,
  },
  argTypes: {
    title: { control: 'text' },
    description: { control: 'text' },
    submitLabel: { control: 'text' },
    cancelLabel: { control: 'text' },
    isSubmitting: { control: 'boolean' },
    canSubmit: { control: 'boolean' },
  },
} satisfies Meta<typeof FormPageDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

// Header, two fields, and the built-in Cancel/Save footer.
export const Default: Story = {};

// Submitting: the Save button shows its loading state and Cancel is disabled.
export const Submitting: Story = { args: { isSubmitting: true } };

// Cannot submit: the Save button is disabled (e.g. a failing validation gate).
export const CannotSubmit: Story = { args: { canSubmit: false } };
