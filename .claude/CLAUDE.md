## vexp — Context‑Aware AI Coding (selective, operational use)

vexp provides a pre‑indexed, graph‑ranked view of the **local codebase only**.  
Use it when the task requires understanding **structure, relationships, or impact inside this repo**.

---

## Step 1 — When to use vexp

**Use vexp whenever the task involves navigating or understanding the codebase beyond a single known file.**  
This includes:

- locating where something is defined or implemented  
- finding who calls what  
- understanding relationships, flows, or ownership  
- assessing impact or blast radius of a change  
- debugging behaviour that depends on cross‑file interactions  
- refactors, feature additions, or anything requiring repo‑level awareness  

If the task touches the repo and you’re unsure whether vexp helps, **use vexp**.

---

## Step 2 — When *not* to use vexp

Do **not** use vexp for tasks that do *not* depend on repo structure:

- external APIs, SaaS tools, cloud services, npm docs  
- workflows, theory, or general programming questions  
- conceptual design discussions  
- tasks where the exact file is already known and no structural reasoning is needed  
- simple string/literal searches  
- Git, CI, filesystem, build, or command‑line questions  

If the task does not require repo context, **skip vexp**.

---

## Step 3 — How to use vexp

When vexp is appropriate:

- **Call `run_pipeline({ task })` first.**  
  This retrieves context, relationships, and impact in one step.

- Use `get_skeleton` to inspect file structure (exports, signatures, types).  
  Prefer this over reading full files.

- Only use Read when you need exact lines to edit.

- Do not call `run_pipeline` more than once per logical task.

---

## Principle

vexp is for **repo‑aware reasoning**.  
Use it when the task depends on how the codebase is structured.  
Skip it when it doesn’t.


s