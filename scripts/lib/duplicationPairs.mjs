// Parsing and rotation for `.github/duplication-pairs.md`, the policy-twin
// register the weekly duplication sweep reads.
//
// Kept apart from the IO so the rotation can be tested without a checkout and
// the register can be validated without running the workflow.

/** The `## N. Title` entries of the register, with the files each one names. */
export function parsePairs(markdown) {
  const entries = [];
  // Entries start at the first numbered heading, so the file's own prose —
  // which contains `##` headings of its own — is never mistaken for one.
  const sections = markdown.split(/^## (?=\d+\.)/m).slice(1);

  for (const section of sections) {
    const [heading, ...rest] = section.split('\n');
    const body = rest.join('\n');
    const match = heading.match(/^(\d+)\.\s*(.+)$/);
    if (!match) continue;

    // Paths live in backticks on the `**Files:**` line. Reading them from there
    // rather than from anywhere in the section keeps a path mentioned in prose
    // (an issue number, a constant) out of the checked set.
    const filesLine = body.split('\n').find((l) => l.startsWith('**Files:**')) ?? '';
    const files = [...filesLine.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

    entries.push({
      number: Number(match[1]),
      title: match[2].trim(),
      files,
      text: `## ${section.trimEnd()}`,
    });
  }
  return entries;
}

export const SLICE_SIZE = 2;

/**
 * The slice of the register a given run examines.
 *
 * Rotation is driven by the run counter rather than by the ISO week the issue
 * originally specced. `date +%V` cannot satisfy the phase's own requirement that
 * two consecutive dispatches examine DIFFERENT pairs — two runs in one week
 * would read the same entry twice and report it as fresh coverage — and it also
 * stalls whenever a week is skipped or a run is retried. The run counter is
 * equally state-free (GitHub supplies it) and strictly increasing, so
 * consecutive runs always advance.
 *
 * Wrapping is by design: with an odd register size and a slice of 2 the walk
 * visits every entry before repeating, so nothing is starved.
 */
export function sliceForRun(entries, runNumber, size = SLICE_SIZE) {
  if (entries.length === 0) return [];
  const start = (runNumber * size) % entries.length;
  return Array.from(
    { length: Math.min(size, entries.length) },
    (_, i) => entries[(start + i) % entries.length],
  );
}
