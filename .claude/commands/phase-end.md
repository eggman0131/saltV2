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
## Step 3 — Commit the changes to github following conventional commit guidelines

Commit Message -
First line: type(scope): short description (under 72 characters)
Then a blank line.
Then 1-2 sentences summarising what the phase does and why.
Then bullet points covering ONLY key decisions and non-obvious choices —
the "why" behind the code. Do NOT list files; git already records that.

Format:
```
type(scope): short description

Phase PHASE_NUMBER. One or two sentence summary of what this phase delivers.

- Decision or non-obvious choice and why
- Decision or non-obvious choice and why

Refs #ISSUE_NUMBER
```

The footer must be exactly one line on its own line, preceded by one
blank line, with NOTHING trailing the issue number. Keep the phase
number in the summary line, not the footer.

**The only `#` in the entire commit message is the footer's
`#ISSUE_NUMBER`.** Commitlint's parser treats every `#<number>` token
as an issue reference; if a `#N` appears in the summary or any body
bullet, the parser folds that line into the footer block, and because
that line is not blank-line-preceded it fires a spurious
`footer-leading-blank` warning even when the real `Refs` footer is
formatted correctly. So everywhere except the footer, drop the hash —
write "issue 84", "cause 1", "phase 2", "PR 80", "GH 79" with no `#`.
Also no text trailing the footer's issue number (e.g. no ` phase N`).

Footer keyword — `Refs` vs `Closes`:
- Use `Refs #ISSUE_NUMBER` for every phase EXCEPT the issue's final phase.
  `Refs` does not auto-close the issue on merge, so a multi-phase issue
  stays open while earlier phases land.
- Use `Closes #ISSUE_NUMBER` ONLY on the issue's last phase, so the issue
  auto-closes when the final phase merges.
- Decide whether PHASE_NUMBER is the final phase from the phase list in
  the issue body (available from the issue read in /phase-start). If
  unsure which phase is last, use `Refs` and tell me in Step 4.

Use type: feat / fix / refactor / test / chore / docs as appropriate.

commit the change, if CI fails, or fails to run - cancel the commit

---
## Step 4 — Personal flags for me

If nothing: write "None."
If something: be brief and direct. Tell me what I should know before
starting the next phase, not what I should do.
