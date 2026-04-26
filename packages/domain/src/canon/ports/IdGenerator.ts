// Infrastructure port: the composition layer provides an implementation
// (using Date.now / crypto.randomUUID); tests inject a deterministic
// counter. Domain commands depend on this port so they remain pure.
//
// Canon owns the ID *format* (the rule that canon IDs look like canon IDs);
// this port owns the *generation* of the entropy that fills it.
export interface IdGenerator {
  newCanonId(): string;
}
