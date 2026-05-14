// VIOLATION: shoppingList must not import another module's internals via subpath.
// Sibling modules may only be imported through their published index.
// Expected: no-restricted-imports error.
import '../../canon/entities/CanonItem';
