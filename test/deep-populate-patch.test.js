'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { patchSource, MARKER } = require('../scripts/patch-deep-populate');

// Minimal stand-in for the compiled plugin bundle: it contains every anchor the
// patch script rewrites. Keeping the fixture local means the test does not break
// when the upstream dist changes for unrelated reasons.
const FIXTURE = `"use strict";
async function _populateRelation({ contentType, relation, resolvedRelations, ...params }) {
  const relations = Array.isArray(relation) ? relation : [relation];
  for (const relation2 of relations) {
    resolvedRelations.set(relation2.documentId, {});
    const relationPopulate = await _populate({ documentId: relation2.documentId, ...params });
    resolvedRelations.set(relation2.documentId, relationPopulate);
  }
}
async function _populate({ contentType, schema: schema2, populate = {}, resolvedRelations, resolvedSchemas, ...params }) {
  resolvedRelations.set(params.documentId, true);
  resolvedSchemas.add(schema2);
  if (shouldMarkContentTypeAsResolved(contentType, undefined, [])) {
    resolvedRelations.set(contentType, true);
  }
}
async function populate(params) {
  const resolvedRelations = new Map();
  const resolvedSchemas = new Set();
  const populated = await _populate({ schema: params.contentType, resolvedRelations, resolvedSchemas, ...params });
  populate_log(populated);
  const dependencies = [
    ...[...resolvedRelations.keys()].filter((r) => !r.startsWith("api::")),
    ...resolvedSchemas.values()
  ];
  return { populate: populated, dependencies };
}
`;

const extractFilter = (source) => {
  const match = source.match(/\.filter\(((\(r\) => [^\n]+))\),/);
  assert.ok(match, 'could not locate the dependency filter callback');
  // eslint-disable-next-line no-new-func
  return new Function(`return (${match[1]});`)();
};

test('original filter crashes on a null relation key (the reported bug)', () => {
  const original = extractFilter(FIXTURE);
  assert.equal(original('api::course.course'), false);
  assert.equal(original('abc123'), true);
  assert.throws(() => original(null), /Cannot read properties of null/);
});

test('patchSource guards every null-prone set() and the dependency filter', () => {
  const { source, edits } = patchSource(FIXTURE);

  assert.equal(edits, 5);
  assert.ok(source.includes('if (relation2 != null && relation2.documentId != null) resolvedRelations.set(relation2.documentId, {});'));
  assert.ok(source.includes('if (relation2 != null && relation2.documentId != null) resolvedRelations.set(relation2.documentId, relationPopulate);'));
  assert.ok(source.includes('if (params.documentId != null) resolvedRelations.set(params.documentId, true);'));
  assert.ok(source.includes('if (contentType != null) resolvedRelations.set(contentType, true);'));
  assert.ok(source.includes('typeof r === "string" && !r.startsWith("api::")'));
});

test('patched filter ignores non-string keys instead of throwing', () => {
  const { source } = patchSource(FIXTURE);
  const patched = extractFilter(source);

  assert.equal(patched(null), false);
  assert.equal(patched(undefined), false);
  assert.equal(patched(0), false);
  assert.equal(patched('api::course.course'), false);
  assert.equal(patched('v9x6cil79cpu5fzie9m0yep2'), true);
});

test('patchSource is idempotent', () => {
  const first = patchSource(FIXTURE);
  const second = patchSource(first.source);
  assert.equal(second.edits, 0);
  assert.equal(second.source, first.source);
});

test('debug mode adds the logging helper and null-key probes', () => {
  const { source } = patchSource(FIXTURE, { debug: true });
  assert.ok(source.includes(MARKER));
  assert.ok(source.includes('__dpDebug("[set:_populate documentId]'));
  assert.ok(source.includes('__dpDebug("[filter] dropped non-string key='));
});

test('patchSource refuses to touch a file without the expected anchors', () => {
  assert.throws(() => patchSource('"use strict";\nmodule.exports = {};\n'), /anchor not found/);
});

test('the installed plugin bundle in node_modules is patched (postinstall)', () => {
  const target = path.join(
    __dirname,
    '..',
    'node_modules',
    '@fourlights',
    'strapi-plugin-deep-populate',
    'dist',
    'server',
    'index.js'
  );
  if (!fs.existsSync(target)) return; // dependency pruned – nothing to assert

  const source = fs.readFileSync(target, 'utf8');
  assert.ok(
    source.includes('typeof r === "string" && !r.startsWith("api::")'),
    'run `node scripts/patch-deep-populate.js` (or npm run postinstall) to apply the guard'
  );
});
