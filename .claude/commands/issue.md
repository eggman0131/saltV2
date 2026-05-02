# Write GitHub Issue

Now create the GitHub issue for this feature.

Use this exact structure:

---
## Context
[Why this feature exists. What problem it solves. 1-2 paragraphs.]

## Architecture references
- @[file.md] — [one line on what's relevant in it]
- @[file.md] — [one line on what's relevant in it]

## Constraints & decisions
- [Key decision 1 and why]
- [Key decision 2 and why]
- [Things Sonnet must NOT do / touch]

## Phases

### Phase 1: [Name]
**Scope:** [What gets built]
**Deliverables:** [Specific files, functions, or behaviours that will exist when this is done]
**Sonnet must not:** [anything explicitly out of scope]

### Phase 2: [Name]
**Scope:** [What gets built]
**Depends on:** Phase 1 — [specific thing from phase 1 it builds on]
**Deliverables:** [Specific files, functions, or behaviours]
**Sonnet must not:** [anything explicitly out of scope]

### Phase 3: [Name]
[etc.]

## Definition of done
[How we'll know the whole feature is complete]
---

Do not write any code. Do not add implementation detail beyond what Sonnet needs to understand scope.
