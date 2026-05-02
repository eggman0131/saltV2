// VIOLATION: Cloud Functions must not import @salt/local-store.
// CFs run server-side; there is no browser storage. Expected: no-restricted-imports error.
import '@salt/local-store';
