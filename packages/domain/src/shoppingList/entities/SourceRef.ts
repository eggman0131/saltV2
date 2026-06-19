export type SourceRef =
  | {
      readonly kind: 'manual';
      /** First name of the member who added the item, when known. */
      readonly addedBy?: string;
    }
  | {
      readonly kind: 'recipe';
      readonly recipeId: string;
      readonly servings: number;
      readonly label?: string;
    };
