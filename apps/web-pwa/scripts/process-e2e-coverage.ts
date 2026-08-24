import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import V8ToIstanbul from 'v8-to-istanbul';
import libCoverage from 'istanbul-lib-coverage';
import libReport from 'istanbul-lib-report';
import reports from 'istanbul-reports';

interface FunctionRange {
  startOffset: number;
  endOffset: number;
  count: number;
}

interface FunctionCoverage {
  functionName: string;
  ranges: FunctionRange[];
  isBlockCoverage: boolean;
}

interface V8CoverageEntry {
  url: string;
  source?: string;
  functions: FunctionCoverage[];
}

// Collection is opt-in (#945), so "nothing to process" is the expected state for
// anyone who ran a plain `e2e`. Say which flag turns it on rather than leaving
// them to find the fixture.
const HOW_TO_COLLECT =
  'E2E coverage collection is opt-in — run `pnpm --filter @salt/web-pwa e2e:coverage`, ' +
  'or set E2E_COVERAGE=1 for the Playwright run you want measured.';

const RAW_DIR = resolve('coverage', 'e2e-raw');
const OUT_DIR = resolve('coverage', 'e2e');
const APP_ORIGIN = 'http://127.0.0.1:5174';

async function main(): Promise<void> {
  let files: string[];
  try {
    files = await readdir(RAW_DIR);
  } catch {
    console.error('No raw coverage directory found at', RAW_DIR);
    console.error(HOW_TO_COLLECT);
    process.exit(1);
  }

  const jsonFiles = files.filter((f) => f.endsWith('.json'));
  if (jsonFiles.length === 0) {
    console.error('No .json files found in', RAW_DIR);
    console.error(HOW_TO_COLLECT);
    process.exit(1);
  }

  console.log(`Processing ${jsonFiles.length} raw coverage file(s)...`);

  const coverageMap = libCoverage.createCoverageMap({});

  for (const file of jsonFiles) {
    const raw = JSON.parse(await readFile(join(RAW_DIR, file), 'utf8')) as V8CoverageEntry[];

    for (const entry of raw) {
      if (!entry.url.startsWith(`${APP_ORIGIN}/`)) continue;
      if (!entry.source) continue;

      try {
        const converter = new V8ToIstanbul(entry.url, 0, { source: entry.source });
        await converter.load();
        converter.applyCoverage(entry.functions);
        coverageMap.merge(converter.toIstanbul());
      } catch {
        // Skip entries that can't be converted (e.g. Vite internal runtime chunks)
      }
    }
  }

  await mkdir(OUT_DIR, { recursive: true });

  const context = libReport.createContext({ dir: OUT_DIR, coverageMap });
  (reports.create('html') as libReport.ReportBase).execute(context);
  (reports.create('lcov') as libReport.ReportBase).execute(context);

  console.log(`Reports written to ${OUT_DIR}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
