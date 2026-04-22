// spec: SPEC.md §3.5 v0.2.3
import { getContext, setContext } from 'svelte';

export function createContext<T>(name: string) {
  const key = Symbol(name);
  return {
    set: (value: T) => setContext(key, value),
    get: (): T => {
      // Svelte 5 throws lifecycle_outside_component when getContext is called
      // outside a component; we catch both that and a missing key (undefined)
      // and surface a single, named error message per §3.5.
      let value: T | undefined;
      try {
        value = getContext<T>(key);
      } catch {
        throw new Error(`${name} context not found. Wrap in the matching root component.`);
      }
      if (value === undefined) {
        throw new Error(`${name} context not found. Wrap in the matching root component.`);
      }
      return value;
    },
    key,
  };
}
