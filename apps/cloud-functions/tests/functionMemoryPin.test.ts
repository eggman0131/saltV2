import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Every function definition must pin `memory` INLINE (issue #883).
//
// `setGlobalOptions({ memory: '512MiB' })` sits at index.ts:100, but
// firebase-functions bakes global options into each function's `__endpoint`
// EAGERLY at definition time, and ES imports evaluate before that line runs. So a
// module imported at the top of index.ts — which is every trigger, callable, auth
// hook and scheduled job in this directory — never sees the global and silently
// falls to the 256MiB platform default. index.ts says so in prose; nothing
// enforced it.
//
// 256MiB does not cover this repo's module-init baseline (firebase-admin +
// Genkit + OTel + posthog-node). The trap has landed three times: chefChat OOMed
// at "263 MiB used, 7 over"; onEquipmentManifestWritten was killed after
// authoring its first equipment brief, stranding every other item with no
// description to review and no icon to draw; and snapshotVolumetrics was one
// collection scan away from the same. Each was found in production logs, which
// is the expensive way to find them.
//
// Deliberately a SOURCE scan, not an endpoint assertion: the failure mode is a
// NEW file that forgets the pin, and a test with a hand-maintained import list
// would miss precisely that file. Nothing here imports the functions, so the
// guard stays free of their module-init cost.
const DEFINITION =
  /\b(onCall|onCallGenkit|onRequest|onDocumentWritten|onDocumentCreated|onDocumentUpdated|onDocumentDeleted|onSchedule|onTaskDispatched|beforeUserCreated|beforeUserSignedIn|onObjectFinalized)\s*\(/;
const PIN = /\bmemory:\s*'/;

// The one definition site that must NOT pin: a factory whose options come from
// its callers, each of which this scan checks in its own right. Pinning here
// would silently override what a caller asked for.
const FACTORY = 'tracedCallable.ts';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** Comments mention `onCall(` all over this codebase; only real code counts. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('function memory pins', () => {
  it('every file defining a function pins memory inline', () => {
    const unpinned = sourceFiles(SRC)
      .filter((path) => !path.endsWith(FACTORY))
      .filter((path) => {
        const code = stripComments(readFileSync(path, 'utf8'));
        return DEFINITION.test(code) && !PIN.test(code);
      })
      .map((path) => path.slice(SRC.length + 1));

    expect(
      unpinned,
      `these define a function but inherit the 256MiB default: ${unpinned.join(', ')}`,
    ).toEqual([]);
  });

  it('sees through comments and spots a missing pin', () => {
    // Guards the guard. A regex that quietly stopped matching, or a comment
    // stripper that ate real code, would make the scan above vacuously green.
    const commentOnly = '// onCall (NOT onCallGenkit): this is not a Genkit flow.\n';
    expect(DEFINITION.test(stripComments(commentOnly))).toBe(false);

    const unpinned = "export const x = onCall({ region: 'europe-west2' }, async () => {});";
    expect(DEFINITION.test(stripComments(unpinned))).toBe(true);
    expect(PIN.test(stripComments(unpinned))).toBe(false);

    const pinned = "export const x = onCall({ memory: '512MiB' }, async () => {});";
    expect(PIN.test(stripComments(pinned))).toBe(true);
  });
});
