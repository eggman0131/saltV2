## vexp — Context-Aware AI Coding (selective use)

vexp provides a pre-indexed, graph-ranked view of the *local codebase only*.
Use it when understanding **relationships, impact, or structure inside this repo**
would materially improve accuracy or speed. Do not use it by default.

---

### Step 1 — Decide if vexp adds value

Before using any tool, decide:

“Am I reasoning about **how this codebase works internally**?”

- If **yes**, use vexp.
- If **no**, do not use vexp.

When in doubt, prefer using vexp.

---

### Always use vexp when the task involves:
- Where something is implemented
  - “Where is X defined / implemented?”
  - “Who calls Y?”
- Change impact or blast radius
  - “What does changing Z affect?”
  - “If I refactor this, what breaks?”
- Codebase navigation or architecture
  - entry points, layering, ownership, cross‑module flows
- Understanding internal types, exports, or abstractions
- Refactors that require awareness of usage and coupling

➡️ Use:
`run_pipeline({ task })`
(or `preset: "refactor"` for blast‑radius analysis)

---

### Do NOT use vexp when the task is:
- About **external services or content**
  - GitHub issues/PRs, APIs, SaaS tools, npm docs, cloud services
- About **tools, workflows, or theory**
  - “How does X usually work?”
- About **known files or direct edits**
  - You already have the file path
- Simple string or literal search
- Git, CI, filesystem, builds, or commands
- Planning, explanation, or discussion without codebase inspection

➡️ Use standard reasoning, Bash, Read/Edit, or web tools instead.

---

### File inspection rules
- To understand a file’s shape (exports, signatures, types):
  ➜ Use `get_skeleton`
- Only use Read when you need exact lines to edit.

---

### Usage constraints
- Do not call `run_pipeline` more than once per logical task.
- Do not retry vexp with synonyms if results are weak.
- vexp cannot see the internet — do not use it for external lookups.

---

### Principle
vexp is a **scalpel**, not a hammer.
Use it when internal context matters; skip it when it doesn’t.