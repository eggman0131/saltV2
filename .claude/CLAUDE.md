vexp — Context‑Aware AI Coding (Salt V2 Architecture Edition) 
MANDATORY: Core Principle
Salt V2's strict hexagonal architecture means almost every non-trivial task has cross-package impact (e.g., domain changes rippling into firebase-sync, cloud-functions, or web-pwa).

Do NOT use grep, glob, or manual cat chains to map code relationships.

Use vexp as the primary engine for structural mapping, impact analysis, and cross-package discovery.

Step 1 — When to Trigger vexp
You MUST invoke the vexp pipeline at the start of a task if it meets any of the following criteria:

Cross-Package Radius: The task touches or may affect more than one package/layer in the hexagonal architecture.

Impact Analysis: You are changing a domain type, shared interface, database schema, or core service.

Relationship Discovery: You need to find who calls what, locate definitions across layers, or understand control flow.

When to SKIP vexp:

You are editing a single, known file with zero external architectural side-effects (e.g., fixing a UI typo, updating a single isolated test utility).

For simple, single-file tasks, standard Read or specific tools are acceptable. If unsure, default to vexp.

Step 2 — Workflow & Fluid Context Execution
To solve context evolution during complex tasks, follow this iterative execution loop:

Initial Vector: Call run_pipeline({ task: "..." }) FIRST for all structural tasks. Let it auto-detect intent and map the initial blast radius.

Structural Inspection: Use get_skeleton (using minimal, standard, or detailed parameters) to inspect type signatures and exports. Prefer this over full file Reads to achieve 70-90% token savings.

Targeted Implementation: Use Read only when you are ready to edit exact lines of raw content.

Context Evolution (The Pivot Rule): If a complex task evolves mid-execution, or an unexpected compilation error reveals a new architectural dependency, you are explicitly permitted to call run_pipeline again with an updated task description or explicit preset (e.g., preset: "refactor"). Do not chain calls blindly, but treat it as a checkpoint reset when the logical direction changes.

Step 3 — Primary Tooling Reference
run_pipeline({ task: "...", preset: "...", include_tests: true })

Tip: For deep hexagonal refactors, explicitly pass preset: "refactor" to force depth-5 impact analysis.

Tip: If hunting a cross-layer bug, use preset: "debug" to loop in capsule, test, and memory context.

get_skeleton({ files: [...], detail: "standard" }) — Use this to safely peek at cross-package boundaries without flooding the context window.