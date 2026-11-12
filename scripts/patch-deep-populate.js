#!/usr/bin/env node
'use strict';

/**
 * Local patch for `@fourlights/strapi-plugin-deep-populate`.
 *
 * ── The bug ────────────────────────────────────────────────────────────────
 * While walking a deep-populated graph the plugin records every visited
 * documentId / content-type UID in a `resolvedRelations` Map, then builds the
 * cache dependency list from its keys:
 *
 *     ...[...resolvedRelations.keys()].filter((r) => !r.startsWith("api::"))
 *
 * If any visited relation carries a `null` / `undefined` documentId, that value
 * is stored as a Map key and the `startsWith` call throws:
 *
 *     TypeError: Cannot read properties of null (reading 'startsWith')
 *
 * The plugin catches nothing, so any request that triggers deep population
 * (i.e. `populate=*` with `replaceWildcard: true`, such as opening a course
 * whose chapters were imported) fails with HTTP 500.
 *
 * In this project the null key comes from `plugin::users-permissions.permission`
 * rows whose `document_id` column is NULL (Strapi's legacy query layer does not
 * fill it in). Those rows are reached through
 * `… → chapter_progresses / exam_attempts → user → role → permissions`.
 * `src/utils/permission-document-ids.js` keeps that data consistent; this patch
 * makes the plugin resilient regardless of what is in the database.
 *
 * ── The fix ────────────────────────────────────────────────────────────────
 * Two layers of defence, applied to the *installed* copy of the plugin (never
 * to code we control):
 *   1. every `resolvedRelations.set(...)` is guarded so null / undefined keys
 *      are never inserted, and
 *   2. the dependency filter only inspects string keys.
 *
 * It is wired into `npm run postinstall`, so the patch survives re-installs,
 * and it is idempotent: the pristine file is kept next to the patched one as
 * `dist/server/index.js.orig` and always used as the patch base.
 *
 * Usage:
 *   node scripts/patch-deep-populate.js          # apply the guard
 *   node scripts/patch-deep-populate.js --debug  # apply + log null keys to .tmp/deep-populate-debug.log
 *   node scripts/patch-deep-populate.js --restore
 */

const fs = require('fs');
const path = require('path');

const TARGET = path.join(
  __dirname,
  '..',
  'node_modules',
  '@fourlights',
  'strapi-plugin-deep-populate',
  'dist',
  'server',
  'index.js'
);
const BACKUP = `${TARGET}.orig`;
const MARKER = '/* patched: deep-populate null-guard';

/**
 * Rewrite the plugin's compiled server bundle so it can never crash on a
 * null/undefined relation key.
 *
 * @param {string} source - contents of dist/server/index.js
 * @param {{ debug?: boolean }} [options]
 * @returns {{ source: string, edits: number }}
 */
function patchSource(source, { debug = false } = {}) {
  let out = source;
  let edits = 0;

  const replace = (oldStr, newStr) => {
    if (out.includes(newStr)) return; // already applied
    if (!out.includes(oldStr)) {
      throw new Error(`[patch-deep-populate] anchor not found:\n${oldStr}`);
    }
    out = out.replace(oldStr, newStr);
    edits += 1;
  };

  if (debug && !out.includes(MARKER)) {
    const anchor = '"use strict";\n';
    if (!out.includes(anchor)) {
      throw new Error('[patch-deep-populate] module preamble not found');
    }
    out = out.replace(
      anchor,
      anchor +
        '\n' +
        MARKER +
        ' (scripts/patch-deep-populate.js) */\n' +
        'const __dpDebug = (msg) => { try { require("fs").appendFileSync(require("path").join(process.cwd(), ".tmp", "deep-populate-debug.log"), Date.now() + " " + msg + "\\n"); } catch (e) {} };\n'
    );
    edits += 1;
  }

  // 1. Don't insert null/undefined relation documentIds into the resolver map.
  replace(
    '    resolvedRelations.set(relation2.documentId, {});',
    debug
      ? '    if (relation2 == null || relation2.documentId == null) __dpDebug("[set:relation-open] contentType=" + String(contentType) + " relation=" + JSON.stringify(relation2));\n' +
          '    if (relation2 != null && relation2.documentId != null) resolvedRelations.set(relation2.documentId, {});'
      : '    if (relation2 != null && relation2.documentId != null) resolvedRelations.set(relation2.documentId, {});'
  );

  replace(
    '    resolvedRelations.set(relation2.documentId, relationPopulate);',
    debug
      ? '    if (relation2 == null || relation2.documentId == null) __dpDebug("[set:relation-close] contentType=" + String(contentType));\n' +
          '    if (relation2 != null && relation2.documentId != null) resolvedRelations.set(relation2.documentId, relationPopulate);'
      : '    if (relation2 != null && relation2.documentId != null) resolvedRelations.set(relation2.documentId, relationPopulate);'
  );

  // 2. Don't insert a null documentId / contentType coming from the caller.
  replace(
    '  resolvedRelations.set(params.documentId, true);',
    debug
      ? '  if (params.documentId == null) __dpDebug("[set:_populate documentId] contentType=" + String(contentType) + " schema=" + String(schema2) + " params=" + JSON.stringify(params));\n' +
          '  if (params.documentId != null) resolvedRelations.set(params.documentId, true);'
      : '  if (params.documentId != null) resolvedRelations.set(params.documentId, true);'
  );

  replace(
    '    resolvedRelations.set(contentType, true);',
    debug
      ? '    if (contentType == null) __dpDebug("[set:_populate contentType] schema=" + String(schema2) + " params=" + JSON.stringify(params));\n' +
          '    if (contentType != null) resolvedRelations.set(contentType, true);'
      : '    if (contentType != null) resolvedRelations.set(contentType, true);'
  );

  // 3. Defence in depth: the dependency filter must never call .startsWith on a
  //    non-string, whatever ends up in the map.
  replace(
    '    ...[...resolvedRelations.keys()].filter((r) => !r.startsWith("api::")),',
    debug
      ? '    ...[...resolvedRelations.keys()].filter((r) => { if (typeof r !== "string") { __dpDebug("[filter] dropped non-string key=" + String(r)); return false; } return !r.startsWith("api::"); }),'
      : '    ...[...resolvedRelations.keys()].filter((r) => typeof r === "string" && !r.startsWith("api::")),'
  );

  return { source: out, edits };
}

function main() {
  const debug = process.argv.includes('--debug');
  const restoreOnly = process.argv.includes('--restore');

  if (!fs.existsSync(TARGET)) {
    // Plugin not installed (e.g. production dependency pruning) – nothing to do.
    return;
  }

  if (restoreOnly) {
    if (fs.existsSync(BACKUP)) {
      fs.copyFileSync(BACKUP, TARGET);
      console.log('[patch-deep-populate] restored pristine plugin file');
    } else {
      console.log('[patch-deep-populate] no backup found, nothing to restore');
    }
    return;
  }

  // Always patch from the pristine copy so re-running is safe and predictable.
  if (fs.existsSync(BACKUP)) {
    fs.copyFileSync(BACKUP, TARGET);
  } else {
    fs.copyFileSync(TARGET, BACKUP);
  }

  const { source, edits } = patchSource(fs.readFileSync(TARGET, 'utf8'), { debug });
  fs.writeFileSync(TARGET, source);

  console.log(
    `[patch-deep-populate] applied ${edits} guard${edits === 1 ? '' : 's'}${debug ? ' (debug logging on)' : ''}`
  );
}

module.exports = { patchSource, MARKER };

if (require.main === module) {
  main();
}
