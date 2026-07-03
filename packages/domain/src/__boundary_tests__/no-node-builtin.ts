// VIOLATION: @salt/domain is the pure layer — no Node built-ins or I/O. Platform
// code belongs in an adapter. Expected: no-restricted-imports error.
// @ts-nocheck — the import is intentionally illegal for domain; the lint rule is
// what enforces purity.
import { readFileSync } from 'node:fs';
console.log(readFileSync);
