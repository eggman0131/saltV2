// spec: SPEC.md §9.3 v0.2.3
import type { Snippet } from 'svelte';

export type DetailPageProps = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  backLabel?: string;
  actions?: Snippet;
  metadata?: Snippet;
  children?: Snippet;
  class?: string;
};
