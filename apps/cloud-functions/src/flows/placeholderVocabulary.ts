import type { PlaceholderCondition, PlaceholderMood } from '@salt/domain';

// Shared placeholder tag vocabulary (issue #652), on the same footing as
// CATEGORY_TAG_RULES: two prompts have to say what these tags mean, so what they
// mean lives here once and neither prompt gets to paraphrase it.
//
// The two consumers read it in different shapes and both are built from the same
// source below:
//   - generateRecipeImage glosses only the tags a picture actually carries, so a
//     `bright` document is never told what `comfort` looks like.
//   - describeRecipeScene teaches the whole vocabulary up front, because the art
//     director is handed an arbitrary `Tags:` line and has to read whatever is on
//     it.
//
// They drifted the moment they were written separately: the art director's prompt
// still described `bright` as "cool daylight, pale crockery, a sunlit table" long
// after the generator stopped saying anything of the kind, and it defined none of
// the five conditions at all while being fed them.
//
// ─── The two axes ───────────────────────────────────────────────────────────
// MOOD is mandatory and owns the ROOM: enclosure versus openness, warmth versus
// air, heavy versus light. CONDITION is optional and owns the SEASON, the WEATHER
// and the LIGHT. Neither may assert the other's territory, because any mood
// combines with any condition and the mismatched pairs are the whole reason both
// axes exist — a bright cold January, a muggy grey August. A `comfort` gloss
// claiming "the weather shut outside" against a `hot` gloss claiming "doors open"
// describes neither.
//
// Every condition also reads as EVENING, because every placeholder is dinner.
export const PLACEHOLDER_MOOD_MEANINGS: Record<PlaceholderMood, string> = {
  bright:
    'openness and air: pale surfaces, clean uncluttered space, clear light colour, an easy unhurried room with nothing heavy or closed-in',
  comfort:
    'enclosure and warmth: drawn in close and intimate, lamplight rather than overhead light, deep saturated colour, soft heavy textures, everything close to hand',
};

export const PLACEHOLDER_CONDITION_MEANINGS: Record<PlaceholderCondition, string> = {
  wet: 'rain running down the glass and standing on the ground beyond it, the room lit against a wet, darkening evening',
  sunny:
    'late, low sun coming in almost level: long raking shadows thrown across the surface, warm light catching the edges of things',
  cloudy: 'flat, soft, even overcast light with almost no shadow anywhere',
  hot: 'a properly hot day cooling into the evening: everything cold beaded and sweating, hazy late light, doors and windows open to the outside',
  cold: 'a properly cold night: condensation on the inside of the windows, thick knitted and woollen textures, everything steaming',
};

// The "<tag> — <meaning>" form, for listing a picture's OWN tags back to the
// image model. Keyed across both axes so a caller can gloss a mixed tag array
// without caring which axis each entry came from.
export const PLACEHOLDER_TAG_MEANINGS: Record<PlaceholderMood | PlaceholderCondition, string> = {
  bright: `bright — ${PLACEHOLDER_MOOD_MEANINGS.bright}`,
  comfort: `comfort — ${PLACEHOLDER_MOOD_MEANINGS.comfort}`,
  wet: `wet — ${PLACEHOLDER_CONDITION_MEANINGS.wet}`,
  sunny: `sunny — ${PLACEHOLDER_CONDITION_MEANINGS.sunny}`,
  cloudy: `cloudy — ${PLACEHOLDER_CONDITION_MEANINGS.cloudy}`,
  hot: `hot — ${PLACEHOLDER_CONDITION_MEANINGS.hot}`,
  cold: `cold — ${PLACEHOLDER_CONDITION_MEANINGS.cold}`,
};

export function isPlaceholderTag(tag: string): tag is PlaceholderMood | PlaceholderCondition {
  return Object.prototype.hasOwnProperty.call(PLACEHOLDER_TAG_MEANINGS, tag);
}

// The whole vocabulary as one block of prose, for a system prompt that has to be
// able to read any tag line it is handed. It states the axis separation
// explicitly, because a model told only what the words mean will still average a
// mood into a season unless it is told that combining them is the point.
export const PLACEHOLDER_TAG_VOCABULARY = `The tags carry the evening, on two axes that must be read together rather than blended. \
The MOOD is always there, and says what the ROOM feels like: "bright" is ${PLACEHOLDER_MOOD_MEANINGS.bright}; \
"comfort" is ${PLACEHOLDER_MOOD_MEANINGS.comfort}. A picture may also carry WEATHER CONDITIONS, which own the season, \
the weather and the quality of the light — never the mood: "wet" is ${PLACEHOLDER_CONDITION_MEANINGS.wet}; "sunny" is \
${PLACEHOLDER_CONDITION_MEANINGS.sunny}; "cloudy" is ${PLACEHOLDER_CONDITION_MEANINGS.cloudy}; "hot" is \
${PLACEHOLDER_CONDITION_MEANINGS.hot}; "cold" is ${PLACEHOLDER_CONDITION_MEANINGS.cold}. Any mood combines with any \
condition — a bright room on a bitter night, a snug one on a muggy grey evening — so let neither overrule the other. \
It is always an evening meal, whatever the weather says.`;
