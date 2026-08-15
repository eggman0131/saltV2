// Kitchen-memory module (issue #816) — the household's own notes for the chef.
// This file is the ONLY thing other domain modules and adapters import from
// `memory`; anything not re-exported here is private.
//
// The tenant that keeps the module alive is `parseChatCommand`: the decision that
// a note is captured by READING the line rather than by asking a model. That is a
// policy, and a load-bearing one — it is what makes writing a note free, instant
// and available offline, and it is why there is no flow, no `AI_FLOW_ROLES` entry
// and no per-turn cost anywhere on the capture path.
//
// Deliberately NOT a general slash-command registry. There is one command, and a
// registry would be an empty barrel kept warm for commands nobody has asked for —
// see docs/domain-implementation.md §8 on what earns a module its place.
export { parseChatCommand } from './parseChatCommand.js';
export type { ChatCommand } from './parseChatCommand.js';
