import sharp from 'sharp';

// Background removal for Tier-1 canon icons (issue #148).
//
// gemini-2.5-flash-image cannot emit alpha — it paints the icon on a flat
// off-white background (and, asked for transparency, a checkerboard). The house
// style keeps the subject centred and never touching the frame edge, so we can
// recover transparency with an edge-seeded flood fill: starting from every
// border pixel, flood inward across pixels that match the flat fill colour
// (within a tolerance) and zero their alpha. The fill stops at the subject's
// dark outline, leaving the subject opaque and the surround transparent.
//
// Pure function over a buffer: takes encoded image bytes, returns a ~128px
// square WebP with an alpha channel.

const TARGET_SIZE = 128;

// Squared-distance tolerance for "is this pixel the background colour". The
// flat fill is a single solid colour, so a modest tolerance absorbs JPEG/WebP
// ringing near the outline without eating into the (dark-outlined) subject.
const DEFAULT_COLOUR_TOLERANCE = 32;

export interface RemoveFlatBackgroundOptions {
  /** Output square edge length in px (default 128). */
  readonly size?: number;
  /** Per-channel colour match tolerance, 0–255 (default 32). */
  readonly tolerance?: number;
}

/** Sample the median of the four corner pixels as the flat background colour. */
function sampleBackgroundColour(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
): { r: number; g: number; b: number } {
  const corners = [
    0,
    (width - 1) * channels,
    (height - 1) * width * channels,
    ((height - 1) * width + (width - 1)) * channels,
  ];
  const median = (vals: number[]): number =>
    vals.sort((a, b) => a - b)[Math.floor(vals.length / 2)]!;
  return {
    r: median(corners.map((c) => data[c]!)),
    g: median(corners.map((c) => data[c + 1]!)),
    b: median(corners.map((c) => data[c + 2]!)),
  };
}

export async function removeFlatBackground(
  input: Buffer,
  options: RemoveFlatBackgroundOptions = {},
): Promise<Buffer> {
  const size = options.size ?? TARGET_SIZE;
  const tolerance = options.tolerance ?? DEFAULT_COLOUR_TOLERANCE;
  const tolSq = tolerance * tolerance;

  // Decode to raw RGBA so we can edit alpha per pixel.
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const channels = info.channels; // 4 after ensureAlpha
  const bg = sampleBackgroundColour(data, width, height, channels);

  const matchesBackground = (px: number): boolean => {
    const dr = data[px]! - bg.r;
    const dg = data[px + 1]! - bg.g;
    const db = data[px + 2]! - bg.b;
    return dr * dr + dg * dg + db * db <= tolSq;
  };

  // Edge-seeded flood fill. Stack of pixel indices (not byte offsets).
  const visited = new Uint8Array(width * height);
  const stack: number[] = [];
  const pushSeed = (x: number, y: number): void => {
    stack.push(y * width + x);
  };
  for (let x = 0; x < width; x++) {
    pushSeed(x, 0);
    pushSeed(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    pushSeed(0, y);
    pushSeed(width - 1, y);
  }

  while (stack.length > 0) {
    const idx = stack.pop()!;
    if (visited[idx]) continue;
    visited[idx] = 1;

    const px = idx * channels;
    if (!matchesBackground(px)) continue;

    // Background pixel reachable from an edge → make it transparent.
    data[px + 3] = 0;

    const x = idx % width;
    const y = (idx - x) / width;
    if (x > 0) stack.push(idx - 1);
    if (x < width - 1) stack.push(idx + 1);
    if (y > 0) stack.push(idx - width);
    if (y < height - 1) stack.push(idx + width);
  }

  return sharp(data, { raw: { width, height, channels } })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ alphaQuality: 100 })
    .toBuffer();
}
