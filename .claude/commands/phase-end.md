# Phase End

Use $ARGUMENTS as "PHASE_NUMBER ISSUE_NUMBER" (e.g. `/phase-end 2 42`).

Phase PHASE_NUMBER is complete. Do the following in order:

---
## Step 1 — Post the handoff summary as a GitHub issue comment

Using the GitHub MCP tool, post a comment on issue #ISSUE_NUMBER with
this exact content (filled in for this phase):

```
## Phase PHASE_NUMBER delivered

**What was built:**
- [specific thing 1]
- [specific thing 2]
- [specific thing 3]

**Key interfaces/contracts the next phase must respect:**
- [function signature, data shape, API endpoint, etc.]

**Do not touch:**
- [files or things that are now settled and should not be changed]
```

Post this comment before producing anything else. Confirm when done.

---
## Step 2 — Post a separate comment if there are flags or deviations

Only do this step if there is something worth recording on the issue:
a deviation from the spec, a deferred concern, something that affects
a future phase, or a decision that needs sign-off.

If nothing to flag: skip this step entirely.

If something to flag, post a second comment on issue #ISSUE_NUMBER:
- Be specific: what was found, what was done instead, what the risk
  or follow-up is, and which phase it affects
- Do not summarise what was built — that belongs in the commit

---
## Step 3 — Produce the commit message

Output this for me to copy into git:

First line: type(scope): short description (under 72 characters)
Then a blank line.
Then 1-2 sentences summarising what the phase does and why.
Then bullet points covering ONLY key decisions and non-obvious choices —
the "why" behind the code. Do NOT list files; git already records that.

Format:
```
type(scope): short description

One or two sentence summary of what this phase delivers.

- Decision or non-obvious choice and why
- Decision or non-obvious choice and why

Closes #ISSUE_NUMBER phase PHASE_NUMBER
```

Use type: feat / fix / refactor / test / chore / docs as appropriate.

---
## Step 4 — Personal flags for me

If nothing: write "None."
If something: be brief and direct. Tell me what I should know before
starting the next phase, not what I should do.
