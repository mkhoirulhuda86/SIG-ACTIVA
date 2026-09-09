import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { isCostStructureAuthorized } from '../../role-authorization';

test('unauthenticated Cycle upload authorization returns 401', async () => {
  const route = await readFile('app/api/cost-structure/cycle/upload/init/route.ts', 'utf8');
  const auth = await readFile('lib/api-auth.ts', 'utf8');
  assert.ok(route.indexOf('requireCostStructurePrepare(request)') < route.indexOf('request.json()'));
  assert.match(auth, /status: 401/);
});
test('unauthorized role on Cycle upload returns 403', async () => {
  assert.equal(isCostStructureAuthorized('STAFF_PRODUCTION', 'PREPARE'), false);
  const auth = await readFile('lib/cost-structure/auth.ts', 'utf8');
  assert.match(auth, /status: 403/);
});
