import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { nextCycleUploadVersion, replacementStates } from './version-policy';
import { removeCycleUploadIfUnreferenced } from './upload-repository';

test('duplicate hash is constrained per period and version increments deterministically', async () => {
  const schema = await readFile('prisma/schema.prisma', 'utf8');
  assert.match(schema, /@@unique\(\[periodId, fileHashSha256\]\)/);
  assert.equal(nextCycleUploadVersion([]), 1); assert.equal(nextCycleUploadVersion([1, 2]), 3);
});
test('valid replacement activates the created version and supersedes prior identity', () => {
  assert.deepEqual(replacementStates({ id: 4 }, { id: 5 }, true), { supersededId: 4, activeId: 5 });
});
test('invalid replacement preserves the prior active version', () => {
  assert.deepEqual(replacementStates({ id: 4 }, { id: 5 }, false), { supersededId: null, activeId: 4 });
});
test('invalid first upload creates no active baseline', () => {
  assert.deepEqual(replacementStates(null, { id: 5 }, false), { supersededId: null, activeId: null });
});
test('first valid upload becomes active while invalid upload is created for audit before activation policy', async () => {
  assert.deepEqual(replacementStates(null, { id: 5 }, true), { supersededId: null, activeId: 5 });
  const repository = await readFile('lib/cost-structure/cycle/repository/upload-repository.ts', 'utf8');
  assert.ok(repository.indexOf('costCycleUpload.create') < repository.indexOf('replacementStates(currentActive, upload, !invalid)'));
  assert.match(repository, /status: invalid \? 'INVALID' : 'VALIDATED'/);
});
test('master seed is idempotent, governance-safe, and migration has no destructive statements', async () => {
  const sql = await readFile('prisma/migrations/20260909090000_add_cost_cycle_ingestion/migration.sql', 'utf8');
  assert.match(sql, /ON CONFLICT \("receiverCc"\) DO UPDATE/g);
  assert.match(sql, /7203311054.*7203311053.*VALIDATED/);
  assert.match(sql, /7203141081.*NULL.*MANUAL_REQUIRED/);
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE\s+FROM|ALTER\s+TABLE\s+(?!"cost_cycle_))\b/i);
});

test('duplicate completion removes only the newly uploaded storage object', async () => {
  const route = await readFile('app/api/cost-structure/cycle/upload/complete/route.ts', 'utf8');
  const duplicateBranch = route.slice(route.indexOf('error instanceof DuplicateCycleUploadError'));
  assert.ok(duplicateBranch.indexOf('costStructureStorage.remove(pending.objectKey)') < duplicateBranch.indexOf('status: 409'));
});

test('ambiguous persistence cleanup deletes confirmed orphan and otherwise fails conservatively', async (t) => {
  await t.test('confirmed orphan', async () => {
    let removed = 0;
    await removeCycleUploadIfUnreferenced({ findReference: async () => null, remove: async () => { removed += 1; } });
    assert.equal(removed, 1);
  });
  await t.test('confirmed reference', async () => {
    let removed = 0;
    await removeCycleUploadIfUnreferenced({ findReference: async () => ({ id: 9 }), remove: async () => { removed += 1; } });
    assert.equal(removed, 0);
  });
  await t.test('lookup outcome unknown', async () => {
    let removed = 0;
    await removeCycleUploadIfUnreferenced({ findReference: async () => { throw new Error('database unavailable'); }, remove: async () => { removed += 1; } });
    assert.equal(removed, 0);
  });
});
