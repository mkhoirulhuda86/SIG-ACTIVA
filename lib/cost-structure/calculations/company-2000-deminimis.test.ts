import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { calculateCompany2000 } from './company-2000';
import type { ResolvedSourceLine } from './types';

const d = (value: string | number) => new Prisma.Decimal(value);
const unmapped = (amount: string): ResolvedSourceLine => ({
  sourceRowId: 1,
  uploadId: 8,
  uploadVersion: 1,
  logicalSourceCode: 'CC_ADUM',
  sourceRowNumber: 80,
  coaId: 1,
  coaCode: '66250008',
  amount: d(amount),
  disposition: 'UNMAPPED',
  mappingId: undefined,
  mappingAction: undefined,
  costGroupId: undefined,
  groupCode: undefined,
  natureId: undefined,
  natureCode: undefined,
  targetActive: false,
  natureCalculationType: undefined,
  applicableMappingCount: 0,
});

test('Company 2000 Engine 1 skips absolute Rp1 unmapped amounts', () => {
  const result = calculateCompany2000({ sourceLines: [unmapped('-1.00')] });
  assert.equal(result.actualLines.length, 0);
  assert.equal(result.companyTotal.toString(), '0');
});

test('Company 2000 Engine 1 still blocks amounts above Rp1', () => {
  assert.throws(
    () => calculateCompany2000({ sourceLines: [unmapped('1.01')] }),
    /no effective mapping/
  );
});
