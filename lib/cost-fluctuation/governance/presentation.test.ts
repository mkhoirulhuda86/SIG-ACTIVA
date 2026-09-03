import assert from 'node:assert/strict';
import test from 'node:test';
import { commentaryActions, explainMaterialityRule, governancePermissions, isCommentaryTarget } from './presentation';

test('staff accounting and admin can prepare commentary directly', () => {
  assert.deepEqual(governancePermissions('STAFF_ACCOUNTING'), { canPrepare: true, canReview: false, canAdmin: false });
  assert.deepEqual(governancePermissions('ADMIN_SYSTEM'), { canPrepare: true, canReview: true, canAdmin: true });
  assert.deepEqual(governancePermissions('AUDITOR_INTERNAL'), { canPrepare: false, canReview: false, canAdmin: false });
});

test('Nature and COA are the only commentary targets', () => {
  assert.equal(isCommentaryTarget('NATURE'), true);
  assert.equal(isCommentaryTarget('COA'), true);
  for (const target of ['COMPANY', 'ANALYSIS_BASIS', 'COST_GROUP', 'CALCULATED_ITEM']) assert.equal(isCommentaryTarget(target), false);
});

test('commentary is direct-save with no submit/checker lifecycle in the UI', () => {
  const maker = governancePermissions('STAFF_ACCOUNTING');
  for (const status of [undefined, 'DRAFT', 'SUBMITTED', 'RETURNED', 'REVIEWED']) {
    const actions = commentaryActions(status, maker, 10, 10);
    assert.equal(actions.canEdit, true);
    assert.equal(actions.canSubmit, false);
    assert.equal(actions.canCheck, false);
    assert.equal(actions.immutable, false);
    assert.equal(actions.makerCheckerBlocked, false);
  }
});

test('materiality AND/OR explanations do not invent thresholds', () => {
  assert.match(explainMaterialityRule('100', '20', 'AND'), / AND /);
  assert.match(explainMaterialityRule('100', '20', 'OR'), / OR /);
  assert.match(explainMaterialityRule('', '', 'OR'), /No business threshold is assumed/);
});
