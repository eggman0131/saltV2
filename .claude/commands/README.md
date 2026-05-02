# ~/.claude/commands

Slash commands for the Opus → Sonnet implementation workflow.
Type `/command-name [arguments]` in any Claude Code conversation.

Requires the GitHub MCP server to be configured (~/.claude/settings.json).

| Command | Arguments | When to use |
|---|---|---|
| `/design` | feature description | Starting a new feature — kicks off design session |
| `/issue` | *(none)* | End of design session — writes the structured GitHub issue |
| `/phase-start` | `PHASE ISSUE` e.g. `2 42` | Opening a new Sonnet phase — reads issue + previous handoff from GitHub automatically |
| `/phase-end` | `PHASE ISSUE` e.g. `2 42` | Phase is done — posts handoff + flags to GitHub, outputs commit message |
| `/arch-update` | feature name | After all phases done — updates architecture docs |
| `/stuck` | `PHASE ISSUE` e.g. `2 42` | Something unexpected mid-phase — reads issue, helps you decide if it's arch or detail |

## Workflow

```
/design  →  /issue  →  /phase-start 1 42
                              ↓
                          [implement]
                              ↓
                        /phase-end 1 42
                        posts to GitHub ✓
                        outputs commit message → git commit
                              ↓
                        /phase-start 2 42
                        reads GitHub automatically ✓
                              ↓
                           repeat...
                              ↓ (when all phases done)
                        /arch-update
```

## What /phase-end posts to GitHub

- **Comment 1 (always):** "Phase N delivered" — handoff summary for the next phase
- **Comment 2 (if needed):** Flags, deviations, deferred concerns, anything affecting future phases

## What /phase-end outputs to chat

- Commit message — paste into git

## What /phase-start reads from GitHub

- The full issue (scope, constraints, decisions)
- The most recent "Phase N-1 delivered" comment (previous handoff)
- Confirms its understanding before writing any code

## Installation

```bash
mkdir -p ~/.claude/commands
cp *.md ~/.claude/commands/
```

Files at `~/.claude/commands/` are available in all projects.
For project-specific commands, use `.claude/commands/` in the repo root.
