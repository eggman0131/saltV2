import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

const ATTACHMENT_NAME = 'ld-session';

function findSessionURL(result: TestResult): string | null {
  for (const attachment of result.attachments) {
    if (attachment.name !== ATTACHMENT_NAME) continue;
    if (attachment.body) return attachment.body.toString('utf8');
    if (attachment.path) return attachment.path;
  }
  return null;
}

export default class LDSessionReporter implements Reporter {
  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status === 'passed' || result.status === 'skipped') return;
    const url = findSessionURL(result);
    if (!url) return;
    const title = test.titlePath().slice(1).join(' › ');
    process.stdout.write(`LD replay: ${url}  (${title})\n`);
  }
}
