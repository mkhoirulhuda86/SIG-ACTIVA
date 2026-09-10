import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as XLSX from 'xlsx';
import { parseCycleWorkbook, validateCycleReceivers } from './index';

const headers = ['Cycle', 'Start Date', 'Segment name', 'Receiver CC', 'Portion/Percent'];
function workbook(rows: unknown[][], customHeaders = headers, sheetName = 'SAP export') {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['report title'], customHeaders, ...rows]), sheetName);
  return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}
const fixed = ['7FT1GF', new Date('2023-01-01T00:00:00Z'), 100001, 7203311054, 12.5];
const variable = ['7VT1GF', new Date('2023-01-01T00:00:00Z'), 100001, 7203311054, 0];

test('detects a valid non-Sheet1 workbook containing both supported cycles', () => {
  const parsed = parseCycleWorkbook(workbook([fixed, variable]));
  assert.equal(parsed.sheetName, 'SAP export'); assert.equal(parsed.summary.fixedRows, 1); assert.equal(parsed.summary.variableRows, 1); assert.equal(parsed.summary.errorCount, 0);
});
test('reports required header missing', () => assert.equal(parseCycleWorkbook(workbook([], headers.slice(0, 4))).issues[0].code, 'MISSING_REQUIRED_COLUMN'));
test('reports Fixed cycle missing', () => assert.ok(parseCycleWorkbook(workbook([variable])).issues.some(issue => issue.code === 'MISSING_FIXED_CYCLE')));
test('reports Variable cycle missing', () => assert.ok(parseCycleWorkbook(workbook([fixed])).issues.some(issue => issue.code === 'MISSING_VARIABLE_CYCLE')));
test('blocks unexpected cycle codes', () => assert.ok(parseCycleWorkbook(workbook([['OTHER', new Date(), '1', '7203311054', 1], fixed, variable])).issues.some(issue => issue.code === 'UNEXPECTED_CYCLE')));
test('blocks duplicate canonical source keys', () => assert.ok(parseCycleWorkbook(workbook([fixed, fixed, variable])).issues.some(issue => issue.code === 'DUPLICATE_TARGET_KEY')));
test('blocks Receiver CC absent from active master', () => {
  const parsed = validateCycleReceivers(parseCycleWorkbook(workbook([fixed, variable])), new Set());
  assert.ok(parsed.issues.some(issue => issue.code === 'UNMAPPED_RECEIVER_CC' && issue.receiverCc === '7203311054'));
});
test('numeric-looking Receiver CC and Segment retain canonical identifier strings', () => {
  const parsed = parseCycleWorkbook(workbook([fixed, variable]));
  assert.equal(parsed.rows[0].receiverCc, '7203311054'); assert.equal(parsed.rows[0].segmentName, '100001');
  assert.doesNotMatch(parsed.rows[0].receiverCc, /[eE]|\.0$/); assert.doesNotMatch(parsed.rows[0].segmentName, /[eE]|\.0$/);
});
test('retains Fixed non-zero and Variable zero rows for downstream overall status derivation', () => {
  const parsed = parseCycleWorkbook(workbook([fixed, variable]));
  assert.deepEqual(parsed.rows.map(row => row.portion), [12.5, 0]);
});
