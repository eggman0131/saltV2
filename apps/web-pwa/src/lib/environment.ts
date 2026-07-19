// Non-production environment banner shown in the app's TopBar.
//
// `import.meta.env.MODE` is Vite's build target and maps 1:1 to the deployment
// environment — the SAME value observability.ts registers as the OTel-standard
// `deployment.environment`: 'development' (local `vite` dev + emulators), 'dev'
// (s2-dev-eggman cloud, `build:dev`), 'staging' (s2-stage-ccb22, `build:staging`),
// or 'production' (`build`). Every non-prod mode gets a bold coloured TopBar and a
// centred label so it's impossible to mistake for production; production returns a
// null banner and keeps the default bar.
//
// The colour classes live here rather than in @salt/ui-components so the generic
// TopBar stays environment-agnostic, and so Tailwind v4 scans these literals via
// web-pwa's own `@source` glob (see app.css).

export interface EnvBanner {
  /** Centred label rendered in the TopBar (uppercased by the component). */
  label: string;
  /** Tailwind classes for the TopBar surface — background + text + border colour. */
  barClass: string;
}

const BANNERS: Record<string, EnvBanner> = {
  // 'development' is local `vite` + emulators (→ Local); 'dev' is the s2-dev-eggman
  // cloud env (→ Development). The component uppercases each label.
  development: { label: 'Local', barClass: 'bg-sky-600 text-white border-sky-700' },
  dev: { label: 'Development', barClass: 'bg-violet-600 text-white border-violet-700' },
  staging: { label: 'Staging', barClass: 'bg-amber-500 text-amber-950 border-amber-600' },
};

/** The banner for the current build's environment, or null in production. */
export const envBanner: EnvBanner | null = BANNERS[import.meta.env.MODE] ?? null;
