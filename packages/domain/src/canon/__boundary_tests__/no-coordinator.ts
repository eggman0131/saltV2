// VIOLATION: domain modules must not depend on coordinators.
// Expected: no-restricted-imports error.
import '../../coordinators/something';
