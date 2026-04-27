import type { ReadResult, DomainError } from '@salt/shared-types';
import type { User } from '../entities/User.js';

// Infrastructure port: implemented by adapters (firebase-sync). Magic-link
// flow is two-phase — `sendMagicLink` mails the link; `completeMagicLink` is
// called when the user lands back on the app via that link.
//
// All methods return ReadResult — auth has no revision/conflict semantics.
// Adapters normalise backend errors into DomainError.AuthError.
//
// `observe` is the source of truth for current identity; `getCurrentUser` is
// a synchronous best-effort read (may be null on first paint before the
// adapter has restored state).
export interface AuthProvider {
  sendMagicLink(email: string, continueUrl: string): Promise<ReadResult<void, DomainError>>;

  isMagicLink(url: string): boolean;

  // Caller passes the email used in the original sendMagicLink (the app
  // layer holds it; the adapter is stateless about pending sign-ins).
  completeMagicLink(url: string, email: string): Promise<ReadResult<User, DomainError>>;

  signOut(): Promise<ReadResult<void, DomainError>>;

  observe(callback: (user: User | null) => void): () => void;

  getCurrentUser(): User | null;
}
