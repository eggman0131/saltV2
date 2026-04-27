// Auth module — published surface.
// This file is the ONLY thing other domain modules and coordinators are
// allowed to import from auth.

export type { User } from './entities/User.js';
export type { AuthProvider } from './ports/AuthProvider.js';
