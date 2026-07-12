// Parse a base64 `data:` URI (as returned by the image models' media output)
// into its content type and base64 payload. `flowName` prefixes the error so a
// non-data-URI is attributed to the calling flow. Shared by the two image flows
// (generateRecipeImage, generateCanonIcon) — the only difference was that prefix.
export function parseDataUrl(
  url: string,
  flowName: string,
): { contentType: string; base64: string } {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(url);
  if (!match) {
    throw new Error(`${flowName}: model media is not a base64 data URI`);
  }
  return { contentType: match[1]!, base64: match[2]! };
}
