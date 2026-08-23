# Salt 2.0 — UI Primitives Specification (v0.11)

**Status:** Planning  
**Scope:** `@salt/ui-components` — `ImageCropper` square mode  
**Audience:** AI code-generation agents + human contributors

> Rule: If anything is missing or ambiguous → STOP → extend this spec → regenerate.  
> No invention beyond what is written here.

This document extends **v0.2** through **v0.10**.  
All global rules, architecture, naming, styling, and testing conventions from v0.2 remain in force, as do v0.4 §15 (`ImageCropper`) and the whole of v0.6 §1 — this spec adds a third value to the mode union v0.6 §1.3 declared closed, and changes nothing else about the primitive.

---

## 0. v0.11 Scope

v0.11 introduces:

- **`ImageCropper` square mode** — a third `aspect` value, `'1:1'`, for cropping a photograph into a Tier-1 pictogram frame (§1)

Nothing in v0.11 changes the default behaviour of any existing component. `aspect` still defaults to `'3:2'`; every call site that does not pass it renders, crops and encodes exactly as it did under v0.4 and v0.6, and `'free'` is untouched.

---

# 1. ImageCropper — Square mode

## 1.1 Why a third mode, and why it is a spec amendment

v0.6 §1.3 says outright that adding a third value to `ImageCropperAspect` is a spec amendment rather than a call-site decision. This is that amendment, written before the value was added.

The new consumer is the pictogram upload (issue #892): a person supplies their own photograph in place of the AI-drawn icon for a grocery, a product form, a kitchen tool or a piece of equipment. The uploaded bytes go through the same server-side framing every generated pictogram goes through — `normalizeIconFraming` with `contentMax: 108` — and **that step is why the crop shape matters**, in a way it does not for a hero.

`normalizeIconFraming` finds the subject's **alpha** bounding box, scales its longer side to `contentMax`, and re-pads it dead-centre in a 128px transparent square. Generated pictograms have a real alpha channel (the flat background is removed first), so the box is the drawn subject. **An uploaded photograph is fully opaque**, so its bounding box is the whole crop — and the longer side of *that* is what gets scaled to 108. The consequence is direct:

| Crop shape | Framed result | Beside a pictogram bounded ~108 × ~100 |
| --- | --- | --- |
| `1:1` | 108 × 108 | matches |
| `3:2` | 108 × 72 | reads short |
| a 4:3 phone photo under `free` | 108 × 81 | reads short |
| a 16:9 phone photo under `free` | 108 × 61 | reads conspicuously short |

Neither existing mode delivers the square. `'3:2'` is the wrong shape by construction, and `'free'` **is not a free-hand crop** — v0.6 §1.4 locks its frame to the source image's own ratio, so it hands back whatever shape the camera produced and gives the user no way to square it up. A third locked ratio is the only route, and it is a smaller change than either alternative: no second primitive, no numeric aspect, no re-implementation of downscale/WebP encoding in a consuming app.

## 1.2 What this amends in v0.6 §1

v0.6 §1 stays in force in full, with one clause amended.

1. **§1.3's "two named modes" and its closing sentence, "Adding a third value is a spec amendment, not a call-site decision."** The union is now three named modes. The sentence itself is not repealed — it is **obeyed**, by this document, and it carries forward unchanged to any *fourth* value. The hazard it guards is untouched: `aspect` is still a string union of named modes and still cannot express "some other fixed ratio", so no call site can silently violate the hero contract.

Everything else in v0.6 §1 is untouched and binding: the active-aspect concept (§1.4), the free-mode measurement rules and its placeholder stage, the amended rendering pipeline (§1.5), and the whole of §1.7 except the sentence above.

## 1.3 Props

| Name     | Type                       | Default | Notes                                                                                   |
| -------- | -------------------------- | ------- | ----------------------------------------------------------------------------------------- |
| `aspect` | `'3:2' \| '1:1' \| 'free'` | `'3:2'` | Which ratio the crop frame is locked to. `'3:2'` is the recipe-hero frame; `'1:1'` is the Tier-1 pictogram frame; `'free'` locks to the source image's own ratio. |

```ts
export type ImageCropperAspect = '3:2' | '1:1' | 'free';
```

The union type continues to be exported from the package barrel alongside `ImageCropperProps` and `ImageCropperHandle`.

**Still a string union, not a number**, for exactly the reason v0.6 §1.3 gives. Three named modes cannot express `16/9` any more than two could.

## 1.4 Behaviour — the active aspect

- **`'1:1'`** — the active aspect is the constant `1`.

`'1:1'` is a **constant mode**, like `'3:2'` and unlike `'free'`. It measures nothing, so it can never be unknown: there is no placeholder stage, the cropper mounts immediately, and `getCroppedBase64()` never returns `null` on account of an unresolved aspect. The free-mode measurement effect must not run for it.

Everything downstream follows the existing rules with no branch of its own. v0.6 §1.5's pipeline already keys off the active aspect, and its `a >= 1` arm covers a square exactly (`outWidth = min(round(area.width), maxEdge)`, `outHeight = round(outWidth / 1)`), so `maxEdge` remains a longest-edge cap and forcing the output canvas to the active ratio still corrects sub-pixel drift.

## 1.5 Guidance for the pictogram call sites

Not a requirement of the primitive, but the reason it exists, recorded so a later reader does not have to reconstruct it:

- A pictogram is stored at 128px square. `maxEdge`'s 1600px default is a needless payload and a needless server-side decode for that target, so pictogram call sites should pass a smaller cap. Choosing one is a call-site decision — `maxEdge` is a plain numeric prop and always has been.
- The primitive does not know about pictograms and must not learn. It produces a square crop; what the square is for belongs to the caller.

## 1.6 Testing requirements

Additive to v0.6 §1.6, which stands in full.

- `aspect="1:1"` renders the stage at a 1:1 ratio.
- `aspect="1:1"` renders the cropper immediately — there is no placeholder stage and no measurement, even for a source whose intrinsic size cannot be read.
- The default (`aspect` unset) and `aspect="3:2"` still render a 3:2 stage, and `aspect="free"` still behaves per v0.6 §1.6 — proving the new value changed neither.
- The zoom slider (`data-testid="image-cropper-zoom"`, `aria-label="Zoom"`) renders in square mode as it does in the other two.

## 1.7 Forbidden

v0.6 §1.7 stands, with its first bullet now reading "other than the three named modes". Additionally:

- Do not give `'1:1'` a placeholder stage or a measurement effect. It is a constant, and treating it like `'free'` would introduce a mount flicker for no reason — see §1.4.
- Do not pass `aspect="1:1"` from the recipe hero flow. The hero is 3:2 (v0.4 §15.1).
- Do not add a fourth value without a v0.12 section. The rule v0.6 §1.3 set is not spent by having been used once.
