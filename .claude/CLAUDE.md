## vexp — Context-Aware AI Coding vexp gives MCP access to a pre-indexed, graph-ranked view of this codebase. Always call vexp when the question is **about code relationships or navigation within this repo**; reach for other tools when it isn't.

### Always use vexp when

- "Where is X implemented / who calls Y / where should this change land?" → `run_pipeline({ task })`
- "What does changing Z affect?" (blast radius) → `run_pipeline({ task, preset: "refactor" })`
- Inspecting a file's shape (signatures, exports, types) → `get_skeleton({ files, detail })` — **Use this instead of Read** for initial inspection; it is significantly faster and token-efficient.

### Use other tools when

- You already know the file path — just Read/Edit it.
- Searching for a literal string, exact import path, config key, or regex — `rg`/`grep` via **Bash** is often faster and more precise than semantic search.
- Filesystem, git, build, or CI questions (`ls`, `git status`, `pnpm test`) — these are not codebase searches.
- **External resources:** GitHub issues, PR descriptions, npm packages, or web docs. **vexp only sees local disk; it cannot fetch live API data.**

### Tool reference

- `run_pipeline({ task })` — runs capsule + impact + memory in a single call. Auto-detects intent from the task. Override with `preset: "debug" | "refactor" | "explore"`; widen with `max_tokens`; add tests with `include_tests: true`; scope with `repos: [...]`.
- `get_skeleton({ files, detail: "minimal" | "standard" | "detailed" })` — file structure without the full body. Prefer over Read for initial file analysis.
- `index_status` — indexed repos and daemon health (use to discover repo aliases).
- `expand_vexp_ref(hash)` — expand `[V-REF:xxxx]` placeholders from compact output.

### Notes

- **Zero-Result Rule:** If `run_pipeline` returns weak pivots or no relevant files, **do not retry with synonyms.** Assume the information is not in the local index and switch to `grep` or external tools (like GitHub API) immediately.
- **Bypassing Hooks:** A PreToolUse hook may block standard Grep/Glob when the vexp daemon is running. If you need a literal search and the standard tool is blocked, run `rg` or `grep` via **Bash** instead. Do not fall back to vexp just because it is the "available" search tool.
- **Don't Chain:** Do not call `run_pipeline` multiple times for the same sub-task. One call already bundles capsule, impact, and memory context.
- **Subagents:** Pass the specific task description to subagents so they can call `run_pipeline` with the correct context rather than re-deriving it.
