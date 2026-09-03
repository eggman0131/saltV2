#!/usr/bin/env node
// One-off audit: which fields are actually ABSENT on the two shopping-list
// collections (issue #1114, phase 1).
//
//   node scripts/audit-shopping-list-fields.mjs --project dev
//   node scripts/audit-shopping-list-fields.mjs --project staging
//   node scripts/audit-shopping-list-fields.mjs --project prod
//
// THIS SCRIPT ONLY READS. It sends nothing but `GET`s, it names no Firestore
// write endpoint, and it holds no code path that could modify a document — and
// that claim is not left as a sentence: `scripts/tests/shoppingFieldAudit.test.mjs`
// scans this file with its comments stripped and reds if a write verb, an HTTP
// method or a commit endpoint ever appears in it (CLAUDE.md → Hard rule 12).
// There is no `--dry-run` flag because there is no other mode.
//
// ─── Why it exists ───────────────────────────────────────────────────────────
//
// `ShoppingListSchema` and `ShoppingListItemSchema` give almost every field a
// `.default()`, so a document with pieces missing does not FAIL validation — it
// is filled in with blanks and delivered to the shopping list as a real row.
// Phase 2 removes those defaults, and removing one over a document that
// genuinely lacks the field would make a real shopping row silently vanish.
//
// Two kinds of default sit in the same `z.object` and read identically:
//
//   • the bug — a field every writer has always written, defaulted for no
//     reason, hiding a malformed document;
//   • the documented additive-back-compat mechanism this repo relies on
//     everywhere — `needsCheck` (#185) is a proven instance, and documents
//     written before it legitimately lack the field.
//
// Nothing in the code tells them apart. Only the real documents do, which is
// what this measures: per field, how many documents lack it, and how many carry
// a value that would fail the un-defaulted schema anyway.
//
// ─── Auth ────────────────────────────────────────────────────────────────────
//
// Your local `gcloud` active account (`gcloud auth login`), the same credential
// scripts/backfill-recipe-attribution.mjs and scripts/export-prod-firestore.mjs
// use, over the Firestore REST API. A cloud agent session has no such
// credential and cannot run this (CLAUDE.md → Worktree rules).

import { execFileSync } from 'node:child_process';
import {
  LIST_FIELDS,
  ITEM_FIELDS,
  auditDocument,
  tally,
  formatTable,
} from './lib/shoppingFieldAudit.mjs';

// Mirrors scripts/restore-firestore.mjs, including the env-var names, so the
// three environments are named the same way wherever they are named.
const ENVIRONMENTS = {
  prod: {
    label: 'PRODUCTION',
    project: process.env.SALT_PROD_PROJECT ?? 's2-prod-e46bd',
    expects: /prod/i,
  },
  staging: {
    label: 'staging',
    project: process.env.SALT_STAGING_PROJECT ?? 's2-stage-ccb22',
    expects: /stag/i,
  },
  dev: {
    label: 'dev-cloud',
    project: process.env.SALT_DEV_PROJECT ?? 's2-dev-eggman',
    expects: /dev/i,
  },
};

// ─── Arguments ────────────────────────────────────────────────────────────────

function die(message) {
  console.error(`✖ ${message}`);
  console.error(
    '\nUsage: node scripts/audit-shopping-list-fields.mjs --project <dev|staging|prod>',
  );
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project') args.project = argv[(i += 1)];
    else die(`Unknown argument: ${arg}`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

// No default project, deliberately: which environment's data is being reported
// on is never something this script should assume, even reading.
if (!args.project) die('--project is required (dev | staging | prod). There is no default.');
const env = ENVIRONMENTS[args.project];
if (!env) die(`Unknown project "${args.project}". Expected one of: dev, staging, prod.`);
if (!env.expects.test(env.project)) {
  die(`Project id "${env.project}" does not look like ${args.project}. Refusing to read it.`);
}

// ─── Firestore REST ───────────────────────────────────────────────────────────

const BASE = `https://firestore.googleapis.com/v1/projects/${env.project}/databases/(default)/documents`;

let token;
try {
  token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
} catch {
  die('Could not get a gcloud access token. Run `gcloud auth login` first.');
}

async function api(url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const path = url.split('/documents')[1];
    throw new Error(`${path} → ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/**
 * Every document of one collection path, masked to the fields being audited.
 *
 * The mask keeps the scan small — a shopping row's `sources`, `originalText`
 * and `traceContext` are never fetched — and it does not change what "absent"
 * means: a masked field the document does not carry is simply not in the
 * response, exactly as it would be unmasked.
 */
async function listDocuments(path, spec) {
  const mask = spec.map(({ name }) => `mask.fieldPaths=${name}`).join('&');
  const docs = [];
  let pageToken = '';
  do {
    const url =
      `${BASE}/${path}?pageSize=300&${mask}` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const page = await api(url);
    for (const doc of page.documents ?? []) {
      docs.push({ id: doc.name.split('/').pop(), fields: doc.fields });
    }
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);
  return docs;
}

// ─── Scan ─────────────────────────────────────────────────────────────────────

console.log(`Project : ${env.project} (${env.label})`);
console.log('Mode    : READ-ONLY — this script writes nothing\n');

const lists = await listDocuments('shoppingLists', LIST_FIELDS);
const listResults = lists.map((d) => auditDocument(d.fields, d.id, LIST_FIELDS));

const itemResults = [];
for (const list of lists) {
  const items = await listDocuments(
    `shoppingLists/${encodeURIComponent(list.id)}/items`,
    ITEM_FIELDS,
  );
  for (const item of items) itemResults.push(auditDocument(item.fields, item.id, ITEM_FIELDS));
}

const listTally = tally(listResults, LIST_FIELDS);
const itemTally = tally(itemResults, ITEM_FIELDS);

console.log(formatTable(`\`shoppingLists/{listId}\` — ${env.project}`, listTally));
console.log();
console.log(formatTable(`\`shoppingLists/{listId}/items/{itemId}\` — ${env.project}`, itemTally));
console.log();

// The one count that is a STOP condition rather than a measurement: the
// projection change delivers the document id in place of this field, which is
// only safe while the two agree everywhere.
const idMismatches =
  (listTally.counts.get('id').reasons.get('differs from document id') ?? 0) +
  (itemTally.counts.get('id').reasons.get('differs from document id') ?? 0);
if (idMismatches > 0) {
  console.log(`✖ ${idMismatches} document(s) carry an \`id\` field that is not the document id.`);
  console.log("  That is a FINDING: issue #1114's `id`-from-document-id decision reopens.");
} else {
  console.log('✔ Every `id` field equals its document id, on both collections.');
}
