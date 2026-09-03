import assert from 'node:assert/strict';
import test from 'node:test';
import { getLockedCostGroupCode, requireLockedCostGroupCode } from './source-cost-group-policy';

test('manual mapping locks every supported CC source to its business Cost Group independent of company', () => {
  assert.equal(getLockedCostGroupCode('CC_ADUM'), 'ADUM');
  assert.equal(getLockedCostGroupCode('CC_PASAR'), 'PASAR');
  assert.equal(getLockedCostGroupCode('CC_PROD'), 'HPP');
  assert.equal(getLockedCostGroupCode('CC_WHRPG'), 'HPP');
});

test('unsupported source fails closed instead of allowing a user-selected Cost Group', () => {
  assert.equal(getLockedCostGroupCode('TB'), null);
  assert.throws(() => requireLockedCostGroupCode('TB'), /SOURCE_COST_GROUP_UNSUPPORTED/);
});
