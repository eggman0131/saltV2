# Phase Start

Use $ARGUMENTS as "PHASE_NUMBER ISSUE_NUMBER" (e.g. `/phase-start 2 42`).

Do the following steps in order before writing any code:

1. Read GitHub issue #ISSUE_NUMBER in full using the GitHub MCP tool
2. Find the most recent issue comment that contains "Phase [N-1] delivered"
   (where N-1 is one less than PHASE_NUMBER) — this is the handoff summary
   from the previous phase. For Phase 1, skip this step.
3. Confirm to me in one short paragraph what you understand your scope to be
   for Phase PHASE_NUMBER, and what constraints you are carrying forward from
   previous phases. Wait for me to confirm before writing any code.

Then implement Phase PHASE_NUMBER with these rules:
- Only build what is in scope for this phase
- Do not modify files outside this phase's scope unless absolutely required —
  if you must, tell me before doing it
- Do not refactor or improve things outside your scope
- If you discover something that looks wrong in a previous phase, flag it
  to me — do not fix it silently

When you are done, tell me:
1. Every file you created or modified
2. Any decisions you made that weren't in the spec, and why
3. Anything I should check or test manually
4. Any concerns about the next phase

Do not write the commit message or next-phase prompt yet — I will ask for
that separately using /phase-end.
