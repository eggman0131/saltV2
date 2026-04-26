// VIOLATION: domain must not import browser storage (IndexedDB) packages.
// Expected: no-restricted-imports error.
import 'idb';
