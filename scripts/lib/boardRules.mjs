// The pure rules `scripts/board.mjs check` decides on, extracted so they can be
// tested. Neither title prefix is a convention this file invented: both were
// already load-bearing elsewhere, which is exactly why they are checkable.

/**
 * A `/campaign` ledger — the tracking issue that command opens so a fresh session
 * can resume, and the parent it hangs its own filings off. It is not work: no
 * `Queue`, no `Class`, closed by hand rather than through a PR, and GitHub's own
 * "add item to project" workflow puts it on the board regardless. `check` skips
 * it in the untriaged rule and the closed-at-a-shipping-status rule, or every
 * campaign that ever ran would sit in its output forever.
 *
 * The prefix is the test because `/campaign` already resumes by searching for it
 * (`.claude/commands/campaign.md` → Setup).
 *
 * `campaign follow-ups:` MUST NOT match. That issue is ordinary work and is
 * triaged like any — and it is one character class away from being exempted
 * here, which would quietly defeat the untriaged rule for the single kind of
 * issue an agent files most often.
 */
export const isLedger = (title) => /^campaign:/i.test(title ?? '');

/**
 * An epic — a container that must sit in the `Epic` band so it never competes
 * for sequence with the work it holds. See docs/issue-board.md.
 *
 * This used to be "has sub-issues", and that was wrong: a parent link is the
 * ordinary way to group an issue with the work it came out of, so #1122 and
 * #1202 were failing the check while correctly sitting in a work band. Every
 * epic this repo has had titles itself `epic:` (#778, #894, #913, #941, #1129).
 */
export const isEpicTitle = (title) => /^epic:/i.test(title ?? '');

/**
 * What `check` should say about an open board item, given where triage got to.
 *
 * `Recommended` means proven, so an agent filing at the end of an unattended run
 * frequently cannot judge the band — and the honest answer is to say so, not to
 * invent one. The floor it parks at instead is `--class`, `--size` and
 * `--status Triage`: a size is a property of the work and always knowable, and
 * `Triage` is the workflow state that says a human owes this a decision.
 *
 * So "no Queue" is two states, not one, and conflating them makes the rule
 * useless within a fortnight — every genuinely undecidable band would read as a
 * failure and the output would be ignored. An item at the floor is WAITING and
 * prints as a note. Anything else with no Queue was filed and abandoned. And a
 * floor that is not enforced is not a floor, so claiming `Triage` without a size
 * fails as well.
 *
 * @returns 'banded' · 'waiting' · 'no-size' · 'abandoned'
 */
export function triageVerdict({ queue, status, size }) {
  if (queue) return 'banded';
  if (status !== 'Triage') return 'abandoned';
  if (!size) return 'no-size';
  return 'waiting';
}
