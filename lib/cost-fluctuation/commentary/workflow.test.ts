import assert from 'node:assert/strict';
import test from 'node:test';
import { nextStatus, WORKFLOW_AUDIT, type WorkflowStatus } from './workflow';

type Row = {
  comparison: string;
  reason: string;
  status: WorkflowStatus;
  version: number;
  history: WorkflowStatus[];
  audits: string[];
  coaId: number | null;
};

const save = (row: Row | null, comparison: string, reason: string, coaId: number | null = null): Row => ({
  comparison,
  reason,
  status: nextStatus(row?.status ?? null, 'SAVE', reason, '', 1, 1),
  version: (row?.version ?? 0) + 1,
  history: [...(row?.history ?? []), 'DRAFT'],
  audits: [...(row?.audits ?? []), WORKFLOW_AUDIT.SAVE],
  coaId,
});

const act = (row: Row, action: 'SUBMIT' | 'RETURN' | 'REVIEW', actor = 2, note = 'review note'): Row => ({
  ...row,
  status: nextStatus(row.status, action, row.reason, note, 1, actor),
  version: row.version + 1,
  history: [...row.history, nextStatus(row.status, action, row.reason, note, 1, actor)],
  audits: [...row.audits, WORKFLOW_AUDIT[action]],
});

test('COM-001 keeps separate MOM YOY YTD reasons', () => {
  assert.deepEqual(['MOM', 'YOY', 'YTD'].map((comparison) => save(null, comparison, `reason-${comparison}`).reason), ['reason-MOM', 'reason-YOY', 'reason-YTD']);
});

test('direct save is append-only and remains editable without approval', () => {
  let row = save(null, 'MOM', 'reason');
  row = save(row, 'MOM', 'revised');
  assert.equal(row.status, 'DRAFT');
  assert.deepEqual(row.history, ['DRAFT', 'DRAFT']);
  assert.equal(row.version, 2);
  assert.deepEqual(row.audits, ['SAVE_COMMENTARY', 'SAVE_COMMENTARY']);
});

test('legacy submitted/reviewed states can be replaced by a direct save', () => {
  const submitted = act(save(null, 'MOM', 'reason'), 'SUBMIT');
  const reviewed = act(submitted, 'REVIEW');
  assert.equal(save(submitted, 'MOM', 'edited after submit').status, 'DRAFT');
  assert.equal(save(reviewed, 'MOM', 'edited after legacy review').status, 'DRAFT');
});

test('save requires nonblank commentary', () => {
  assert.throws(() => save(null, 'MOM', ''), /nonblank commentary/);
});

test('legacy maker/checker transitions remain audit-compatible but are not required by current UI', () => {
  const submitted = act(save(null, 'MOM', 'reason'), 'SUBMIT');
  assert.throws(() => act(submitted, 'RETURN', 2, ''));
  assert.throws(() => act(submitted, 'RETURN', 1), /Maker\/checker/);
  assert.equal(act(submitted, 'RETURN', 2).status, 'RETURNED');
  assert.throws(() => act(submitted, 'REVIEW', 1), /Maker/);
  assert.equal(act(submitted, 'REVIEW', 2).status, 'REVIEWED');
});

test('COA commentary remains a real target with no fabricated COA on non-COA rows', () => {
  assert.equal(save(null, 'MOM', 'nature explanation', null).coaId, null);
  assert.equal(save(null, 'MOM', 'coa explanation', 123).coaId, 123);
});
