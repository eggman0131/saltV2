// What production's recipes actually ask for, as `recipes[].kit[].label`.
//
// Measured for issue #956 against `s2-prod-e46bd` on 2026-08-27: 65 recipes, 40
// of them carrying `kit`, 97 distinct labels over 240 mentions. This fixture
// holds the 88 labels (227 mentions) the issue enumerated when it did that
// count. The nine it did not name were, by construction, labels that ALREADY
// resolved against the forty-tool seed table, so they are the ones a coverage
// test learns least from; every one of the 38 labels that did NOT resolve is
// here, which is what makes this fixture the real test of a vocabulary change.
//
// The counts are not decoration. A label mentioned eleven times and a label
// mentioned once cost the same one drawing to fix, so the ranking is what says
// which gap is worth an argument — "large mixing bowl" ×11 is the headline case
// this whole issue exists for.
//
// It is a SNAPSHOT, deliberately not re-derived at test time: the test must fail
// or pass on what the table says, never on what the library happened to hold the
// morning it ran, and nothing in a unit suite may reach for Firestore. Re-measure
// it when the library has moved on enough to matter; the two read-only `curl`
// commands are in the issue's Reproduction section.
export const PRODUCTION_KIT_LABELS: readonly (readonly [label: string, mentions: number])[] = [
  // bowl — eleven spellings of one object, 31 mentions. The defect in one row.
  ['large mixing bowl', 11],
  ['mixing bowl', 9],
  ['serving bowl', 2],
  ['large bowl', 2],
  ['small bowl', 1],
  ['pasta bowl', 1],
  ['medium mixing bowl', 1],
  ['large serving bowl', 1],
  ['large heatproof bowl', 1],
  ['heatproof bowl', 1],
  ['bowl', 1],
  // spoon
  ['wooden spoon', 10],
  ['spoon', 6],
  ['slotted spoon', 2],
  ['rice spoon', 1],
  ['large spoon', 1],
  // knife
  ['sharp knife', 17],
  ["chef's knife", 1],
  ['bread knife', 1],
  // board
  ['chopping board', 16],
  ['large chopping board', 1],
  // pan
  ['large frying pan', 5],
  ['frying pan', 4],
  ['heavy frying pan', 2],
  ['wide frying pan', 1],
  ['small frying pan', 1],
  // cooker — four different appliances, not one head noun.
  ['rice cooker', 5],
  ['pressure cooker', 3],
  ['sous-vide precision cooker', 1],
  ['slow cooker', 1],
  // saucepan
  ['large saucepan', 4],
  ['saucepan', 3],
  ['small saucepan', 1],
  // sieve
  ['sieve', 6],
  ['fine sieve', 2],
  // jar
  ['jam jar', 3],
  ['tall glass jar', 1],
  ['small jar', 1],
  ['screw-top jar', 1],
  // processor
  ['food processor', 5],
  ['mini food processor', 1],
  // rack
  ['wire rack', 4],
  ['wire cooling rack', 2],
  // plate
  ['plate', 4],
  ['serving plate', 1],
  // blender
  ['stick blender', 2],
  ['immersion blender', 1],
  ['hand blender', 1],
  // dish
  ['baking dish', 2],
  ['deep pie dish', 1],
  ['casserole dish', 1],
  // pot
  ['large pot', 2],
  ['medium pot', 1],
  // spatula
  ['spatula', 2],
  ['metal spatula', 1],
  // container
  ['airtight container', 2],
  ['large container', 1],
  // mixer — a hand mixer and a stand mixer are two machines.
  ['electric hand mixer', 2],
  ['stand mixer', 1],
  // towel
  ['tea towel', 2],
  ['clean tea towel', 1],
  // jug
  ['tall jug', 1],
  ['jug', 1],
  // circulator
  ['sous vide immersion circulator', 1],
  ['immersion circulator', 1],
  // tin — a cake tin and a loaf tin are two shapes.
  ['rectangular cake tin', 1],
  ['loaf tin', 1],
  // mug
  ['mug', 1],
  ['microwave-safe mug', 1],
  // Head nouns production asks for by exactly one spelling.
  ['baking tray', 8],
  ['whisk', 6],
  ['colander', 6],
  ['tongs', 5],
  ['rice paddle', 3],
  ['salad spinner', 3],
  ['vacuum sealer', 2],
  ['baking stone', 2],
  ['mandoline', 2],
  ['meat press', 1],
  ['fork', 1],
  ['meat grinder', 1],
  ['tall beaker', 1],
  ['teaspoon', 1],
  ['waffle maker', 1],
  ['chinois', 1],
  ['food mill', 1],
  ['pudding basin', 1],
  ['trivet', 1],
];
