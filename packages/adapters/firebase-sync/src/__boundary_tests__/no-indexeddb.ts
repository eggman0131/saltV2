// VIOLATION: @salt/firebase-sync must not import browser storage packages.
// Expected: no-restricted-imports error.
import 'idb';
