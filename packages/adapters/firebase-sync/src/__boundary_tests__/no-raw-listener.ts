// VIOLATION: only the three helpers may reach for the SDK's entry points —
// subscribeCollection.ts and subscribeDocument.ts for `onSnapshot`,
// callFunction.ts for `getFunctions`/`httpsCallable` (issue #928).
//
// All three names in ONE fixture on purpose: they are one rule and one reason,
// and three files would assert three times that the same `ignores` list is
// correct. The rule is `no-restricted-imports` with `importNames`, so the sibling
// imports below are NOT violations — `doc`, `collection` and `getFirestore` are
// how the helpers and every writer in the package read and write, and a fixture
// that banned the whole module would pass while describing a rule nobody wants.
// Expected: three no-restricted-imports errors, one per restricted name.
import { onSnapshot, doc, collection, getFirestore } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

export const unused = [onSnapshot, doc, collection, getFirestore, getFunctions, httpsCallable];
