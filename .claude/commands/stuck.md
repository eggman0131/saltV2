# Stuck or Surprised Mid-Phase

Use $ARGUMENTS as "PHASE_NUMBER ISSUE_NUMBER" (e.g. `/stuck 2 42`).

We are mid-implementation of Phase PHASE_NUMBER.

1. Read GitHub issue #ISSUE_NUMBER using the GitHub MCP tool so you have
   the full original design and constraints in front of you.

An unexpected situation has come up:
[DESCRIBE WHAT HAPPENED / WHAT SONNET FLAGGED]

The original design assumed:
[WHAT YOU THOUGHT WOULD HAPPEN]

I need you to:
1. Assess whether this changes the architecture or just the implementation detail
2. If architecture: propose a revised approach and tell me which phases need updating
3. If implementation detail: tell me how Sonnet should handle it within the existing design

Do not redesign the whole feature. Surgical only.

If the resolution requires updating the issue, post a comment on
issue #ISSUE_NUMBER summarising the decision and which phases are affected.
