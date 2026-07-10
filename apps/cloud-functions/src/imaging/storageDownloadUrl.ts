// Public Firebase Storage download URL builder, shared by the image write-back
// paths (canon icons — issue #148; recipe heroes — Tier-2).
//
// We deliberately use the Firebase Storage download endpoint
// (`/v0/b/<bucket>/o/<path>?alt=media`) rather than the raw GCS URL
// (`storage.googleapis.com/<bucket>/<path>`): only the former is governed by
// `storage.rules` (which grant public read on the icon/hero prefixes), so no
// object ACL / `makePublic()` is needed — that path is the raw-GCS IAM model and
// throws on buckets with uniform bucket-level access (the default). The same URL
// shape works against the Storage emulator (just a different host).
export function buildStorageDownloadUrl(bucketName: string, path: string): string {
  const encoded = encodeURIComponent(path);
  // The Firebase emulator suite sets STORAGE_EMULATOR_HOST for the Admin SDK;
  // when present, point the URL at the emulator instead of production.
  const emulatorHost = process.env['STORAGE_EMULATOR_HOST'];
  if (emulatorHost) {
    const host = emulatorHost.replace(/^https?:\/\//, '');
    return `http://${host}/v0/b/${bucketName}/o/${encoded}?alt=media`;
  }
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encoded}?alt=media`;
}
