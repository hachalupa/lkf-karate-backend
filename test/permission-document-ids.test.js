'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { repairPermissionDocumentIds } = require('../src/utils/permission-document-ids');

function fakeStrapi(rows) {
  const calls = { uid: null, findMany: [], updates: [] };

  const permissions = {
    async findMany(args) {
      calls.findMany.push(args);
      return rows.filter((row) => row.documentId == null).map((row) => ({ ...row }));
    },
    async update({ where, data }) {
      calls.updates.push({ where, data });
      const row = rows.find((entry) => entry.id === where.id);
      if (row) row.documentId = data.documentId;
      return row;
    },
  };

  return {
    strapi: {
      query(uid) {
        calls.uid = uid;
        return permissions;
      },
    },
    calls,
    rows,
  };
}

test('backfills a documentId on every permission that is missing one', async () => {
  const ids = ['id-one', 'id-two', 'id-three'];
  let next = 0;
  const { strapi, calls, rows } = fakeStrapi([
    { id: 60, action: 'api::seminar.seminar.find', documentId: null },
    { id: 61, action: 'api::seminar.seminar.findOne', documentId: null },
    { id: 1, action: 'plugin::users-permissions.auth.logout', documentId: 'existing' },
  ]);

  const repaired = await repairPermissionDocumentIds(strapi, () => ids[next++]);

  assert.equal(repaired, 2);
  assert.equal(calls.uid, 'plugin::users-permissions.permission');
  assert.deepEqual(calls.findMany, [{ where: { documentId: { $null: true } } }]);
  assert.deepEqual(
    calls.updates.map((call) => [call.where.id, call.data.documentId]),
    [
      [60, 'id-one'],
      [61, 'id-two'],
    ],
  );
  assert.equal(rows.find((row) => row.id === 1).documentId, 'existing');
});

test('is idempotent once every row has a documentId', async () => {
  const { strapi } = fakeStrapi([
    { id: 60, action: 'api::seminar.seminar.find', documentId: null },
    { id: 61, action: 'api::seminar.seminar.findOne', documentId: null },
  ]);

  let next = 0;
  const generator = () => `generated-${next++}`;

  assert.equal(await repairPermissionDocumentIds(strapi, generator), 2);
  assert.equal(await repairPermissionDocumentIds(strapi, generator), 0);
  assert.equal(next, 2);
});

test('does nothing when there are no broken rows', async () => {
  const { strapi, calls } = fakeStrapi([
    { id: 1, action: 'plugin::users-permissions.auth.logout', documentId: 'existing' },
  ]);

  assert.equal(await repairPermissionDocumentIds(strapi, () => 'unused'), 0);
  assert.equal(calls.updates.length, 0);
});
