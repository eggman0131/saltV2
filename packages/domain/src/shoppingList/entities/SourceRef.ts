export type SourceRef =
  | { readonly kind: 'manual' }
  | {
      readonly kind: 'recipe';
      readonly recipeId: string;
      readonly servings: number;
      readonly label?: string;
    };
