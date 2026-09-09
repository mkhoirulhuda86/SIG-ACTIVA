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

test('Cycle prepare endpoints use prepare authorization and accepted roles remain narrow', async () => {
  for (const routePath of [
    'app/api/cost-structure/cycle/upload/init/route.ts',
    'app/api/cost-structure/cycle/upload/complete/route.ts',
    'app/api/cost-structure/cycle/preview/route.ts',
    'app/api/cost-structure/cycle/generate/route.ts',
  ]) {
    assert.match(await readFile(routePath, 'utf8'), /requireCostStructurePrepare\(request\)/, routePath);
  }
  assert.equal(isCostStructureAuthorized('ADMIN_SYSTEM', 'PREPARE'), true);
  assert.equal(isCostStructureAuthorized('STAFF_ACCOUNTING', 'PREPARE'), true);
  assert.equal(isCostStructureAuthorized('SUPERVISOR_ACCOUNTING', 'PREPARE'), false);
  assert.equal(isCostStructureAuthorized('STAFF_PRODUCTION', 'PREPARE'), false);
});

test('Cycle master PATCH is ADMIN_SYSTEM only', async () => {
  const route = await readFile('app/api/cost-structure/cycle/master/route.ts', 'utf8');
  assert.match(route, /export async function PATCH[\s\S]*requireCostStructureAdmin\(request\)/);
  assert.equal(isCostStructureAuthorized('ADMIN_SYSTEM', 'ADMIN'), true);
  assert.equal(isCostStructureAuthorized('STAFF_ACCOUNTING', 'ADMIN'), false);
  assert.equal(isCostStructureAuthorized('SUPERVISOR_ACCOUNTING', 'ADMIN'), false);
});

test('all Cycle read endpoints retain Cost Structure read authorization', async () => {
  for (const routePath of [
    'app/api/cost-structure/cycle/baseline/route.ts',
    'app/api/cost-structure/cycle/history/route.ts',
    'app/api/cost-structure/cycle/master/route.ts',
    'app/api/cost-structure/cycle/files/[id]/route.ts',
  ]) {
    assert.match(await readFile(routePath, 'utf8'), /requireCostStructureRead\(request\)/, routePath);
  }
  assert.equal(isCostStructureAuthorized('ADMIN_SYSTEM', 'READ'), true);
  assert.equal(isCostStructureAuthorized('STAFF_ACCOUNTING', 'READ'), true);
  assert.equal(isCostStructureAuthorized('SUPERVISOR_ACCOUNTING', 'READ'), true);
  assert.equal(isCostStructureAuthorized('STAFF_PRODUCTION', 'READ'), true);
});
