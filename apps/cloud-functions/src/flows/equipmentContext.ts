// Shared kitchen-equipment prompt fragment for every flow that needs to know what
// the household actually owns. The chef (chefChat) reasons about which kit to
// reach for, and the librarian (authorRecipe) must preserve the appliance
// specifics the chef and user agreed on, so the manifest READ and its RENDERING
// live here once — a single source of truth that cannot drift between the two
// prompts. (Before this, only chefChat read the manifest and authorRecipe
// flattened "in the Pizzaiolo at 400 °C" back to "bake in the oven".)
//
// SCOPE: reading + rendering the manifest, plus the two framings that wrap it.
// The framings are deliberately NOT interchangeable and must not be merged:
//   - EQUIPMENT_CHEF_FRAMING gives the chef licence to CHOOSE kit (proportionately).
//   - EQUIPMENT_LIBRARIAN_FRAMING gives the librarian licence to PRESERVE ONLY.
//     authorRecipe is a temperature-0 transcriber; handing it the manifest must
//     never license it to pick an appliance the conversation did not establish.
//
// No schema change backs this: `AccessorySchema.owned` and `EquipmentItemSchema.rules`
// already exist. Equipment capabilities are deliberately NOT stored — a pro model
// already knows these named products, and stored capabilities would duplicate that
// knowledge and go stale.

import type { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import {
  EquipmentManifestSchema,
  EQUIPMENT_MANIFEST_COLLECTION,
  EQUIPMENT_MANIFEST_DOC_ID,
} from '@salt/domain/schemas';
import type { EquipmentItemDoc } from '@salt/domain/schemas';

/**
 * Renders the equipment manifest as plain text for a system prompt.
 *
 * Owned and unowned accessories are BOTH rendered — unowned ones explicitly
 * marked unavailable — so the chef can say "that needs the XL Steamer
 * Attachment, which you don't have" instead of suggesting it blindly.
 *
 * Returns '' for an empty manifest so the caller can omit the section entirely.
 */
export function renderEquipmentManifest(items: readonly EquipmentItemDoc[]): string {
  if (items.length === 0) return '';
  return items
    .map((item) => {
      const parts = [`- ${item.name}`];
      const owned = item.accessories.filter((a) => a.owned);
      const unowned = item.accessories.filter((a) => !a.owned);
      if (owned.length > 0) {
        parts.push(`  accessories owned: ${owned.map((a) => a.name).join(', ')}`);
      }
      if (unowned.length > 0) {
        parts.push(
          `  accessories NOT owned (unavailable — do not use): ${unowned.map((a) => a.name).join(', ')}`,
        );
      }
      if (item.rules.length > 0) {
        parts.push(
          `  household rules (override your own product knowledge): ${item.rules.join('; ')}`,
        );
      }
      return parts.join('\n');
    })
    .join('\n');
}

/**
 * Reads and renders the shared equipment manifest. Degrades to '' on a missing,
 * corrupt, or unreadable doc — kit context is an enhancement, never a hard
 * dependency, so no flow fails because the manifest is unavailable.
 *
 * `flow` only labels the warn logs so the two callers stay distinguishable.
 */
export async function readEquipmentContext(
  db: ReturnType<typeof getFirestore>,
  flow: string,
): Promise<string> {
  try {
    const snap = await db
      .collection(EQUIPMENT_MANIFEST_COLLECTION)
      .doc(EQUIPMENT_MANIFEST_DOC_ID)
      .get();
    if (!snap.exists) return '';
    const result = EquipmentManifestSchema.safeParse(snap.data());
    if (!result.success) {
      logger.warn(`${flow}: equipmentManifest failed validation, proceeding without kit context`);
      return '';
    }
    return renderEquipmentManifest(result.data.items);
  } catch (err) {
    logger.warn(`${flow}: failed to read equipmentManifest`, { err });
    return '';
  }
}

// ─── Chef framing (chefChat) ─────────────────────────────────────────────────
//
// The chef MAY choose equipment. Sweep-then-detail is expressed as a prompt
// instruction inside the existing single call — there is no second AI round-trip
// and no two-pass pipeline.
const EQUIPMENT_CHEF_FRAMING = `## Your kitchen
This is the equipment this household actually owns. These are real, specific products — \
recognise them and use what you know about them.

Work in two beats. FIRST sweep: consider which of this kit is genuinely relevant to what is \
being cooked. THEN get specific about what you picked — the mode, the temperature, the exact \
accessory, and why it is the right choice. Say "bake it in the Pizzaiolo at 400 °C for 90 \
seconds on the pizza stone", not "bake in a hot oven".

PROPORTIONALITY IS A RULE, NOT A PREFERENCE. The right tool is the MOST VIABLE one, not the \
most powerful one. Setup, faff, and washing-up are part of the cost and you must weigh them. \
A knife wins for one onion; the 4 mm slicing disc wins for 2 kg of potatoes. Judge the scale \
of the job, the hassle of getting the kit out, and the cleanup — never capability alone. \
Reaching for the biggest appliance for a small job is a mistake, not thoroughness.

Accessories marked NOT owned are unavailable — never assume access to them. If the best method \
needs one, say so plainly ("that really wants the XL Steamer Attachment, which you don't have") \
and give the best alternative using what they do own.

Where an item lists household rules, those are the household's own plain-English instructions \
for that equipment. They OVERRIDE your general product knowledge — follow them exactly, even \
when they contradict what you know about the product.

You remain completely free to suggest techniques that need no special kit at all — a pan, a \
bowl, and a knife are often the right answer. This is not a mandate to shoehorn appliances into \
every step. Stay conversational and natural; equipment detail should feel like a knowledgeable \
friend pointing at the right machine, not a spec sheet.`;

// ─── Librarian framing (authorRecipe) ────────────────────────────────────────
//
// The librarian MUST NOT choose equipment. It is a temperature-0 transcriber and
// the manifest is there ONLY so it recognises appliance names it sees in the
// transcript. Rewriting an agreed hob method for the Pizzaiolo would be a worse
// failure than the flattening this fixes.
const EQUIPMENT_LIBRARIAN_FRAMING = `## Kitchen equipment (for RECOGNITION ONLY)
The household owns the equipment below. It is listed for ONE reason: so you recognise these \
appliance, accessory, and mode names when they appear in the conversation and transcribe them \
faithfully. It is NOT a menu to choose from.

- PRESERVE the equipment specifics the conversation established — the named appliance, the mode, \
the temperature, the accessory, the timing. Keep them in the step text exactly as agreed.
- NEVER generalise a named appliance back to a generic one. If the conversation says "Pizzaiolo", \
the step says "Pizzaiolo" — not "the oven". Same for a named accessory, mode, or setting.
- NEVER introduce, substitute, or upgrade equipment the conversation did not establish. If the \
conversation says hob, the step says hob, even when something fancier is listed here. Inventing \
equipment is a worse error than omitting it.`;

/**
 * The chef's equipment section, or '' when there is no manifest to show.
 */
export function equipmentSectionForChef(equipmentContext: string): string {
  if (!equipmentContext) return '';
  return `${EQUIPMENT_CHEF_FRAMING}\n\n${equipmentContext}`;
}

/**
 * The librarian's equipment section, or '' when there is no manifest to show.
 */
export function equipmentSectionForLibrarian(equipmentContext: string): string {
  if (!equipmentContext) return '';
  return `${EQUIPMENT_LIBRARIAN_FRAMING}\n\n${equipmentContext}`;
}
