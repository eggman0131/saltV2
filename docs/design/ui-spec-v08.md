# Salt 2.0 — UI Primitives Specification (v0.8)

**Status:** Planning  
**Scope:** `@salt/ui-components` — `Dial`  
**Audience:** AI code-generation agents + human contributors

> Rule: If anything is missing or ambiguous → STOP → extend this spec → regenerate.  
> No invention beyond what is written here.

This document extends **v0.2**, **v0.3**, **v0.4**, **v0.5**, **v0.6** and **v0.7**.  
All global rules, architecture, naming, styling, and testing conventions from v0.2 remain in force.

---

## 0. v0.8 Scope

v0.8 introduces:

- **`Dial`** — a circular progress indicator with an optional label at its centre (§8.22)

v0.8 changes the behaviour of no existing component. In particular it does **not** alter `Progress` (v0.2 §8.15): the two coexist deliberately, and §8.22.2 says which to reach for.

---

# 8.22 Dial

## 8.22.1 Overview

A ring that draws a `0..1` fraction, with room in the middle for the value it is counting.

It exists because a horizontal bar has no useful small size. `Progress` is `h-2` and full-width; asked to render at badge scale it becomes a dash with no readable fill. A ring keeps its shape all the way down to 34px, which is what lets one component serve a card, a compact row and a nav badge.

The centred label is the other half of the reason. A countdown rendered as a bar needs a separate `mm:ss` beside it, and the two then have to be kept in agreement by the caller. A dial holds both, so a clock and its own progress are a single object.

First consumer: My Kitchen's timer cards (issue #843).

## 8.22.2 Dial or Progress?

| Use                                                                                                        | Component                                                                                                       |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| A quantity advancing toward a known end, laid out in a row with text — a cook's completed steps, an upload | `Progress`                                                                                                      |
| A countdown, or anything whose value belongs **inside** the indicator                                      | `Dial`                                                                                                          |
| Anything below ~40px                                                                                       | `Dial`                                                                                                          |
| Indeterminate ("something is happening, length unknown")                                                   | `Progress` — `Dial` has no indeterminate state and must not grow one; use `Spinner` if there is no value at all |

A cook's step progress stays on `Progress` and is **not** migrated. Both may appear on the same screen; they are different questions, not two dialects of one.

## 8.22.3 Props

| Prop        | Type                   | Default      | Notes                                                    |
| ----------- | ---------------------- | ------------ | -------------------------------------------------------- |
| `value`     | `number`               | `0`          | Fraction drawn, `0..1`. Clamped; non-finite reads as `0` |
| `size`      | `'sm' \| 'md' \| 'lg'` | `'md'`       | 34px / 44px / 60px                                       |
| `tone`      | `'neutral' \| 'heat'`  | `'neutral'`  | See §8.22.5                                              |
| `children`  | `Snippet`              | —            | Rendered centred inside the ring                         |
| `ariaLabel` | `string \| null`       | **required** | `null` is the explicit "decorative" — see §8.22.6        |
| `class`     | `string`               | —            | Merged last via `cn()` (v0.2 §2.3)                       |

`value` is a **fraction, not a percentage**, and takes no `max`. This differs from `Progress` deliberately: every producer in the app already computes a `0..1` ratio (`timerProgress`), and accepting `value`/`max` would invite a second, differently-rounded path to the same number.

## 8.22.4 Geometry

One `viewBox="0 0 52 52"` at every size, `r=22`; the rendered diameter is a CSS concern of the size variant. The sweep is rotated `-90°` about the centre so it begins at twelve o'clock; the track carries no rotation.

Stroke width thickens as the ring shrinks — 4 at `lg`, 5 at `md`, 7 at `sm` — so a badge-sized dial still reads as a ring rather than a hairline circle.

Only `stroke-dashoffset` animates, at **1000ms linear**. That figure is the tick interval of the clock driving it, not a `--duration-*` beat: a shorter transition lands the sweep early and then waits, which reads as a stutter. It is written as a literal for that reason and must not be tokenised. Suppressed entirely under `prefers-reduced-motion: reduce`.

## 8.22.5 Colour

`tone="neutral"` draws the sweep in `--color-primary`.

`tone="heat"` draws it in `--salt-dial-heat`, read from **whatever ancestor sets it**, falling back to `--color-primary` when nobody does.

This indirection is the point: `Dial` owns no opinion about what the colours mean. Timer urgency is a domain concept (`TimerHeat` in `@salt/domain`), and a primitive that enumerated `resting | soon | imminent | ringing` would drag that vocabulary into `@salt/ui-components`, where it does not belong and where the next consumer with a different four states could not use it. The card sets one custom property; the ring stays a ring.

The track is always `--color-muted`.

## 8.22.6 Accessibility

`ariaLabel` is **required** and has no default. A ring with no accessible name is invisible to a screen reader, and silently defaulting one would produce a plausible-sounding wrong label.

- A string → `role="img"` with that `aria-label`.
- `null` → `aria-hidden="true"` and no role. This is the correct choice when adjacent text already carries the value, which is the common case on a card: the label inside the ring is visible text and is announced on its own.

Colour is never the only carrier of state. Any consumer mapping `tone="heat"` to urgency must also render that urgency as text (see the state word on My Kitchen's timer cards), per v0.2 §7.

## 8.22.7 What Dial does not do

- **No indeterminate state.** See §8.22.2.
- **No ticks, no scale marks, no needle.** It is a progress ring, not a gauge; a gauge implies a range with meaningful intermediate values and would need labelled bounds.
- **No interactivity.** It is not a knob and does not accept input. A value the user sets is a `Slider` (v0.3 §4).
- **No text of its own.** Everything visible in the middle comes from `children`, so the primitive never formats a clock or rounds a percentage.
