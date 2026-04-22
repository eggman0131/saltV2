// spec: SPEC.md §8.9 v0.2.3
import type { Snippet } from 'svelte';

type CardPartProps = {
  class?: string;
  children?: Snippet;
};

export type CardProps = CardPartProps;
export type CardHeaderProps = CardPartProps;
export type CardTitleProps = CardPartProps;
export type CardDescriptionProps = CardPartProps;
export type CardContentProps = CardPartProps;
export type CardFooterProps = CardPartProps;
