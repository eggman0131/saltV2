// VIOLATION: @salt/local-store must not import Firebase SDKs.
// Expected: no-restricted-imports error.
import 'firebase/firestore';
