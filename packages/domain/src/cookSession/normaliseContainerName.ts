// How two container names are decided to be THE SAME BOWL (issue #761, Phase 1).
//
// A guided plan's containers are free text on both sides of the join: a prep job
// says where it puts its result ("small bowl"), a step note says which one it
// wants ("Small  bowl "), and nothing anywhere constrains the two to be typed
// identically. They are written by a model and then edited by hand, so the
// difference between them is routinely nothing but case and stray whitespace —
// which is exactly the difference this throws away, and nothing more.
//
// Deliberately NOT `normaliseName` (canon's, exported from the flat package
// index): that one is tuned for matching an INGREDIENT to a canon entry and is
// free to grow accent folding, plural stripping and the rest. A container name is
// a label the cook reads off a bowl on their own bench; folding it any harder
// would start merging bowls a human can plainly tell apart ("onion bowl" vs
// "onions bowl" are two bowls if the plan says they are). The two normalisers
// answer different questions, and the separate name is what keeps them from being
// "tidied" into one.
//
// A blank or whitespace-only name normalises to `''`, which callers read as "this
// names no container at all" — the same thing `container: null` means, arrived at
// from a plan that stored an empty string instead.
export function normaliseContainerName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}
