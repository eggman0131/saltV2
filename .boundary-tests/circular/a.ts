// VIOLATION: circular dependency.
// Expected: dependency-cruiser 'no-circular' error.
import './b.js';

export const A = 'a';
