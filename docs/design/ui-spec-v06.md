# Salt 2.0 — UI Primitives Specification (v0.6)

**Status:** Planning  
**Scope:** `@salt/ui-components` — `ImageCropper` free-aspect mode  
**Audience:** AI code-generation agents + human contributors

> Rule: If anything is missing or ambiguous → STOP → extend this spec → regenerate.  
> No invention beyond what is written here.

This document extends **v0.2**, **v0.3**, **v0.4** and **v0.5**.  
All global rules, architecture, naming, styling, and testing conventions from v0.2 remain in force, as does the whole of v0.4 §15 (`ImageCropper`) **except** the four clauses §1.2 below names and amends.

---

## 0. v0.6 Scope

v0.6 introduces:

- **`ImageCropper` free-aspect mode** — an `aspect` prop (`'3:2' | 'free'`, default `'3:2'`) that lets a caller crop to the source image's own shape instead of the locked recipe-hero frame (§1)

Nothing in v0.6 changes the default behaviour of any existing component. `aspect` defaults to `'3:2'`; every call site that does not pass it renders, crops and encodes exactly as it did under v0.4.

---

# 1. ImageCropper — Free-aspect mode

## 1.1 Overview

v0.4 §15 locked `ImageCropper` to 3:2 because its only consumer was the recipe hero, and the hero frame is always 3:2. A second consumer now needs the same pan/zoom/downscale/WebP-encode machinery for an image that is **not** a hero: a photographed cookbook page, which is portrait. A 3:2 frame over a portrait page cuts off either the ingredients or the method — the crop is lossy in exactly the place the image is being taken for.

The alternative — no cropper, framing by camera alone — would need its own downscale and WebP encode in the consuming app, i.e. a second implementation of logic this primitive already contains. Per the established practice (a second surface wanting an existing behaviour promotes the primitive rather than writing it twice), the aspect lock becomes a **closed, two-valued mode** instead.

`'free'` does not mean "unconstrained". The crop frame in free mode is locked to **the source image's own aspect ratio**, so the user pans and zooms within the shape the camera produced: no letterboxing, no bars, and no edge lost to a frame the image does not fit. The only thing that changes between the two modes is _which_ ratio the frame is locked to.

## 1.2 What this amends in v0.4 §15

v0.4 §15 stays in force in full, with four clauses amended. A reader arriving at §15 alone would otherwise be left with a stale absolute.

1. **§15.2's note, "Aspect ratio is not a prop."** Superseded. Aspect **is** a prop, but a string union of two named modes (§1.3) — never a number. The hazard §15.2 was guarding against (a caller silently violating the recipe-photo contract by passing an arbitrary ratio) is preserved by the union: `'3:2'` is the default and the only way to get a hero-shaped crop, and no value expresses "some other fixed ratio". Its closing sentence — "add a new primitive rather than parameterising this one" — applies to any _third_ behaviour, not to this mode.
2. **§15.4's "fixed-3:2 container (`aspect-[3/2]`)".** The stage's ratio is now the **active aspect** (§1.4), applied as an inline `aspect-ratio` style. In `'3:2'` mode the resulting ratio is identical to the class it replaces. This is a **sanctioned exception to v0.2 §2.3** ("no inline `style` attributes except for numeric transforms"): the value is a number known only at runtime, so Tailwind cannot generate a class for it — the same class of exception, and the same justification, as `Progress`'s numeric `transform`. It is limited to this one declaration on this one element; every other style on the stage stays a utility class.
3. **§15.5 step 3, and §15.3's derived-short-side clause.** Output dimensions derive from the **active aspect**, not the constant `3/2`, and `maxEdge` caps the genuinely longest edge (§1.5). In `'3:2'` mode the arithmetic is unchanged.
4. **§15.6's first testing requirement**, which names the container class `aspect-[3/2]`. The stage no longer carries that class in either mode (see 2 above); assert the ratio via `data-testid="image-cropper-stage"` as §1.6 sets out. The requirement itself — that the default renders a 3:2 stage — is unchanged and restated in §1.6.

Everything else in §15 is untouched and binding in both modes: the `getCroppedBase64()` handle and its bare-base64 (no `data:` prefix) WebP-at-0.92 return, `null` when no crop is ready, `maxEdge`'s meaning, the reset-on-`src` effect, the zoom slider (`min=1`, `max=3`, `step=0.01`, `aria-label="Zoom"`, `data-testid="image-cropper-zoom"`), and the rule that all Canvas/Blob work stays inside `ui-components`.

## 1.3 Props

| Name     | Type              | Default | Notes                                                                                                                      |
| -------- | ----------------- | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| `aspect` | `'3:2' \| 'free'` | `'3:2'` | Which ratio the crop frame is locked to. `'3:2'` is the recipe-hero frame; `'free'` locks to the source image's own ratio. |

```ts
export type ImageCropperAspect = '3:2' | 'free';
```

The union type is exported from the package barrel alongside `ImageCropperProps` and `ImageCropperHandle`, so a consumer can name the mode it passes.

**The prop is a string union, not a number.** A numeric `aspect` would re-open precisely the hazard v0.4 §15.2 closed: a call site could pass `16/9` to the hero flow and produce a photo the rest of the app frames wrongly, with nothing in the type system objecting. Two named modes cannot express that. Adding a third value is a spec amendment, not a call-site decision.

## 1.4 Behaviour — the active aspect

- **`'3:2'`** — the active aspect is the constant `3/2`. Nothing about the component's behaviour, markup ratio or output differs from v0.4.
- **`'free'`** — the active aspect is the source image's `naturalWidth / naturalHeight`, measured once per `src`.

Measuring:

- The measurement runs only in `'free'` mode (the locked mode needs no decode of its own) and re-runs whenever `src` changes, alongside the existing pan/zoom reset (§15.4).
- A measurement that resolves after `src` has already changed again is **discarded** — the frame must never take a stale image's shape.
- A `src` that fails to load, or reports a zero dimension, leaves the active aspect unknown. The primitive does not throw and does not silently fall back to 3:2; the consumer is responsible for a `src` it can load, and a broken one shows only the placeholder below.

**Before the aspect is known** (free mode, measurement in flight or failed), the stage renders as an empty placeholder panel — the same rounded muted surface, at a neutral placeholder height (`min-h-40`), carrying **no** `aspect-ratio` — and `svelte-easy-crop` is **not mounted**. It must not be mounted at 3:2 and then re-laid-out: a crop frame that flashes landscape and snaps to portrait reads as a bug, and the user may have started dragging inside the wrong frame. Growing once from a calm neutral panel to the real frame is the accepted cost, and in practice it is imperceptible because `src` is a local object URL that decodes without a network round-trip.

## 1.5 Rendering pipeline (`getCroppedBase64`) — amended steps

v0.4 §15.5's seven steps stand, with step 3 replaced:

3. Compute output dimensions from the **active aspect** `a`, capping the **longest** edge at `maxEdge`:
   - `a >= 1` (landscape or square — always the case in `'3:2'` mode): `outWidth = min(round(area.width), maxEdge)`, `outHeight = round(outWidth / a)`.
   - `a < 1` (portrait): `outHeight = min(round(area.height), maxEdge)`, `outWidth = round(outHeight * a)`.

This is not a change to what `maxEdge` means — v0.4 §15.2 and §15.3 already define it as a **longest-edge** cap. Under a locked 3:2 frame the width was always the long edge, so capping the width satisfied the contract; a portrait frame makes the height the long edge, and the branch keeps the contract true. Forcing the output canvas to the active ratio still corrects any sub-pixel drift in the source selection, exactly as §15.3 requires.

`getCroppedBase64()` returns `null` when the active aspect is unknown, for the same reason it returns `null` with no crop area: there is nothing well-defined to render.

## 1.6 Testing requirements

- Default (`aspect` unset) renders the stage at a 3:2 ratio — proving the hero call site is untouched.
- Explicit `aspect="3:2"` is identical to the default.
- `aspect="free"` does **not** render a 3:2 stage, and renders no cropper, while the source aspect is unknown.
- `aspect="free"` with a measurable portrait source renders the stage at the source's own ratio.
- The zoom slider (`data-testid="image-cropper-zoom"`, `aria-label="Zoom"`) renders in both modes, including while a free-mode measurement is in flight.
- The `class` prop is merged onto the outer wrapper `<div>` in both modes.
- The stage carries `data-testid="image-cropper-stage"` so the above are assertable without reaching into `svelte-easy-crop`'s internals.

## 1.7 Forbidden

- Do not expose a numeric aspect, or accept a ratio string other than the two named modes — see §1.3.
- Do not pass `aspect="free"` from the recipe hero flow. The hero is 3:2 (v0.4 §15.1) and the rest of the app frames it as such.
- Do not letterbox, pad or bar a free-mode image to fit a fixed stage. The stage takes the image's shape; the image is never fitted to the stage.
- Do not mount the cropper at a provisional ratio while a free-mode measurement is in flight — see §1.4.
- Do not add a second cropper primitive for a portrait use case, and do not re-implement downscale/WebP encoding in a consuming app. Both are this primitive's job.
