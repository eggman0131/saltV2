// spec: SPEC.md §9.2 v0.2.3
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
