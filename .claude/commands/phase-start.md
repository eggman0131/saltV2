# Phase Start

Use $ARGUMENTS as "PHASE_NUMBER ISSUE_NUMBER" (e.g. `/phase-start 2 42`).

Do the following steps in order before writing any code:

1. Read GitHub issue #ISSUE_NUMBER in full using the GitHub MCP tool (not `gh` CLI)2. 
2. Find the most recent issue comment that contains "Phase [N-1] delivered" (where N-1 is one less than  
   PHASE_NUMBER) — this is the handoff summary from the previous phase. For Phase 1, skip this step.
3. Confirm to me in one short paragraph what you understand your scope to be
   for Phase PHASE_NUMBER, and what constraints you are carrying forward from
   previous phases. Wait for me to confirm before writing any code.

Then implement Phase PHASE_NUMBER with these rules:
- Use the GitHub MCP tool for ALL GitHub operations. Do not use `gh` CLI or 
  bash for anything GitHub-related, even if it seems equivalent.
- Only build what is in scope for this phase
- Do not modify files outside this phase's scope unless absolutely required —
  if you must, tell me before doing it
- Do not refactor or improve things outside your scope
- If you discover something that looks wrong in a previous phase, flag it
  to me — do not fix it silently

Do not write the commit message or next-phase prompt yet — I will ask for
that separately using /phase-end.
