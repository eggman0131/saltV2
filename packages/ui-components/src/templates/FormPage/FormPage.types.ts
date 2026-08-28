// spec: ui-spec-v13.md §1 v0.13
import type { Snippet } from 'svelte';

export type FormPageProps = {
  title: string;
  description?: string;
  submitLabel?: string;
  cancelLabel?: string;
  isSubmitting?: boolean;
  canSubmit?: boolean;
  onSubmit?: (event: SubmitEvent) => void;
  onCancel?: () => void;
  footer?: Snippet;
  children?: Snippet;
  class?: string;
};
