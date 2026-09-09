import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { nextCycleUploadVersion, replacementStates } from './version-policy';

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
test('master seed is idempotent, governance-safe, and migration has no destructive statements', async () => {
  const sql = await readFile('prisma/migrations/20260909090000_add_cost_cycle_ingestion/migration.sql', 'utf8');
  assert.match(sql, /ON CONFLICT \("receiverCc"\) DO UPDATE/g);
  assert.match(sql, /7203311054.*7203311053.*VALIDATED/);
  assert.match(sql, /7203141081.*NULL.*MANUAL_REQUIRED/);
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE\s+FROM|ALTER\s+TABLE\s+(?!"cost_cycle_))\b/i);
});
