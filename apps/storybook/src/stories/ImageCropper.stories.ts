import type { Meta, StoryObj } from '@storybook/svelte-vite';
// Rule 7: primitives are consumed ONLY through @salt/ui-components.
import { ImageCropper } from '@salt/ui-components';

// Standard CSF3 (.stories.ts) — see Button.stories.ts. No wrapper is needed: the
// primitive takes plain props, and `class` constrains the stage width.
//
// Both sources are inline `data:` SVGs so nothing is fetched and Chromatic gets a
// deterministic frame. Their intrinsic sizes are the point: DISH is 1200x800
// (already hero-shaped), PAGE is 900x1200 (a photographed cookbook page, the
// shape a 3:2 frame cannot hold).
const DISH =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjAwIiBoZWlnaHQ9IjgwMCIgdmlld0JveD0iMCAwIDEyMDAgODAwIj48cmVjdCB3aWR0aD0iMTIwMCIgaGVpZ2h0PSI4MDAiIGZpbGw9IiMyZjNhMzMiLz48Y2lyY2xlIGN4PSI2MDAiIGN5PSI0MDAiIHI9IjMwMCIgZmlsbD0iI2VmZTdkOCIvPjxjaXJjbGUgY3g9IjYwMCIgY3k9IjQwMCIgcj0iMjMwIiBmaWxsPSIjZTJkNmMwIi8+PGNpcmNsZSBjeD0iNjAwIiBjeT0iNDAwIiByPSIxNDAiIGZpbGw9IiNjOTU1MmYiLz48Y2lyY2xlIGN4PSI1NDAiIGN5PSIzNjAiIHI9IjQyIiBmaWxsPSIjZjJjMTRlIi8+PGNpcmNsZSBjeD0iNjYwIiBjeT0iNDQwIiByPSIzNCIgZmlsbD0iI2YyYzE0ZSIvPjxyZWN0IHg9IjEyMCIgeT0iMTIwIiB3aWR0aD0iMTgwIiBoZWlnaHQ9IjI0IiByeD0iMTIiIGZpbGw9IiM2ZDdmNzAiLz48cmVjdCB4PSI5MDAiIHk9IjY1NiIgd2lkdGg9IjE4MCIgaGVpZ2h0PSIyNCIgcng9IjEyIiBmaWxsPSIjNmQ3ZjcwIi8+PC9zdmc+';

const PAGE =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI5MDAiIGhlaWdodD0iMTIwMCIgdmlld0JveD0iMCAwIDkwMCAxMjAwIj48cmVjdCB3aWR0aD0iOTAwIiBoZWlnaHQ9IjEyMDAiIGZpbGw9IiNmM2VjZTEiLz48cmVjdCB4PSI0OCIgeT0iNDgiIHdpZHRoPSI4MDQiIGhlaWdodD0iMTEwNCIgZmlsbD0iI2ZiZjdmMCIgc3Ryb2tlPSIjZGRkMmMwIiBzdHJva2Utd2lkdGg9IjQiLz48cmVjdCB4PSI5NiIgeT0iMTEyIiB3aWR0aD0iNDIwIiBoZWlnaHQ9IjM0IiByeD0iOCIgZmlsbD0iIzNkM2EzNCIvPjxyZWN0IHg9Ijk2IiB5PSIxNzYiIHdpZHRoPSI2MDAiIGhlaWdodD0iMTQiIHJ4PSI3IiBmaWxsPSIjYTg5Yjg2Ii8+PHJlY3QgeD0iOTYiIHk9IjIwNiIgd2lkdGg9IjUyMCIgaGVpZ2h0PSIxNCIgcng9IjciIGZpbGw9IiNhODliODYiLz48cmVjdCB4PSI5NiIgeT0iMjcyIiB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwIiByeD0iOCIgZmlsbD0iIzdhNmE1MiIvPjxnIGZpbGw9IiNjM2I4YTQiPjxyZWN0IHg9Ijk2IiB5PSIzMjAiIHdpZHRoPSIzMzAiIGhlaWdodD0iMTIiIHJ4PSI2Ii8+PHJlY3QgeD0iOTYiIHk9IjM1MiIgd2lkdGg9IjI5MCIgaGVpZ2h0PSIxMiIgcng9IjYiLz48cmVjdCB4PSI5NiIgeT0iMzg0IiB3aWR0aD0iMzUwIiBoZWlnaHQ9IjEyIiByeD0iNiIvPjxyZWN0IHg9Ijk2IiB5PSI0MTYiIHdpZHRoPSIyNjAiIGhlaWdodD0iMTIiIHJ4PSI2Ii8+PHJlY3QgeD0iOTYiIHk9IjQ0OCIgd2lkdGg9IjMyMCIgaGVpZ2h0PSIxMiIgcng9IjYiLz48cmVjdCB4PSI5NiIgeT0iNDgwIiB3aWR0aD0iMjQwIiBoZWlnaHQ9IjEyIiByeD0iNiIvPjwvZz48cmVjdCB4PSI0NzAiIHk9IjMwMCIgd2lkdGg9IjMzNCIgaGVpZ2h0PSIyNDAiIHJ4PSIxMCIgZmlsbD0iI2U0ZDljNiIvPjxjaXJjbGUgY3g9IjYzNyIgY3k9IjQyMCIgcj0iNzIiIGZpbGw9IiNkODY2M2EiLz48cmVjdCB4PSI5NiIgeT0iNTgwIiB3aWR0aD0iMTgwIiBoZWlnaHQ9IjIwIiByeD0iOCIgZmlsbD0iIzdhNmE1MiIvPjxnIGZpbGw9IiNjM2I4YTQiPjxyZWN0IHg9Ijk2IiB5PSI2MjgiIHdpZHRoPSI3MDgiIGhlaWdodD0iMTIiIHJ4PSI2Ii8+PHJlY3QgeD0iOTYiIHk9IjY2MCIgd2lkdGg9IjY3MiIgaGVpZ2h0PSIxMiIgcng9IjYiLz48cmVjdCB4PSI5NiIgeT0iNjkyIiB3aWR0aD0iNzAwIiBoZWlnaHQ9IjEyIiByeD0iNiIvPjxyZWN0IHg9Ijk2IiB5PSI3MjQiIHdpZHRoPSI2NDAiIGhlaWdodD0iMTIiIHJ4PSI2Ii8+PHJlY3QgeD0iOTYiIHk9Ijc1NiIgd2lkdGg9IjY5MCIgaGVpZ2h0PSIxMiIgcng9IjYiLz48cmVjdCB4PSI5NiIgeT0iNzg4IiB3aWR0aD0iNjAwIiBoZWlnaHQ9IjEyIiByeD0iNiIvPjxyZWN0IHg9Ijk2IiB5PSI4MjAiIHdpZHRoPSI3MDQiIGhlaWdodD0iMTIiIHJ4PSI2Ii8+PHJlY3QgeD0iOTYiIHk9Ijg1MiIgd2lkdGg9IjU2MCIgaGVpZ2h0PSIxMiIgcng9IjYiLz48cmVjdCB4PSI5NiIgeT0iODg0IiB3aWR0aD0iNjg2IiBoZWlnaHQ9IjEyIiByeD0iNiIvPjxyZWN0IHg9Ijk2IiB5PSI5MTYiIHdpZHRoPSI2MjAiIGhlaWdodD0iMTIiIHJ4PSI2Ii8+PHJlY3QgeD0iOTYiIHk9Ijk0OCIgd2lkdGg9IjcwMCIgaGVpZ2h0PSIxMiIgcng9IjYiLz48cmVjdCB4PSI5NiIgeT0iOTgwIiB3aWR0aD0iNDgwIiBoZWlnaHQ9IjEyIiByeD0iNiIvPjwvZz48cmVjdCB4PSI0MDQiIHk9IjEwODAiIHdpZHRoPSI5MiIgaGVpZ2h0PSIxMiIgcng9IjYiIGZpbGw9IiNjM2I4YTQiLz48L3N2Zz4=';

const meta = {
  title: 'Primitives/ImageCropper',
  component: ImageCropper,
  args: {
    src: DISH,
    aspect: '3:2' as const,
    maxEdge: 1600,
    class: 'max-w-md',
  },
  argTypes: {
    src: { control: 'text' },
    aspect: { control: 'inline-radio', options: ['3:2', '1:1', 'free'] },
    maxEdge: { control: { type: 'number', min: 200, max: 4000, step: 100 } },
    class: { control: 'text' },
  },
} satisfies Meta<typeof ImageCropper>;

export default meta;
type Story = StoryObj<typeof meta>;

// The recipe hero flow (ui-spec-v04 §15): the locked 3:2 frame, which is what a
// call site passing no `aspect` gets.
export const Hero: Story = { args: { src: DISH, aspect: '3:2' } };

// The same locked frame over a portrait source — the reason free mode exists.
// The frame can only hold a band across the middle of the page; whatever the user
// pans to, the rest of the page is outside the crop.
export const HeroOverAPortraitSource: Story = { args: { src: PAGE, aspect: '3:2' } };

// Free mode (ui-spec-v06 §1): the stage takes the source's own 3:4 ratio, so the
// whole page is in frame — no letterboxing, no bars, nothing lost to the edges.
// Pan and zoom still work; they just move within the page's own shape.
export const FreeAspectPortrait: Story = { args: { src: PAGE, aspect: 'free' } };

// Free mode is "the image's ratio", not "portrait": a landscape source in free
// mode frames landscape, and here happens to coincide with the hero's 3:2.
export const FreeAspectLandscape: Story = { args: { src: DISH, aspect: 'free' } };

// Square mode (ui-spec-v11 §1): the Tier-1 pictogram frame, for a photograph
// supplied in place of an AI-drawn icon. It is a CONSTANT ratio like the hero's,
// not a measured one — the square is what makes an uploaded photo sit at the same
// apparent size as the pictograms either side of it, because the server frames
// every upload by its longer side.
export const SquarePictogram: Story = { args: { src: DISH, aspect: '1:1' } };

// The same square frame over a portrait source. Whatever shape the camera
// produced, the user pans and zooms to choose what lands inside the square —
// which is precisely what free mode cannot offer, since it locks to the source's
// own ratio and leaves the shape unchosen.
export const SquareOverAPortraitSource: Story = { args: { src: PAGE, aspect: '1:1' } };
