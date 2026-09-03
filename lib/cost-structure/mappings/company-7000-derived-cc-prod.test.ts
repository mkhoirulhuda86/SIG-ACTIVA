import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Prisma } from '@prisma/client';
import { deriveCompany7000CcProdMappingCandidates } from './company-7000-derived-cc-prod';

const row = (
  id: number,
  logicalSourceCode: string,
  coaCodeRaw: string,
  amount: string,
  descriptionRaw = 'TEST'
) => ({
  id,
  logicalSourceCode,
  coaCodeRaw,
  descriptionRaw,
  amount: new Prisma.Decimal(amount),
});

describe('Company 7000 derived CC_PROD mapping candidates', () => {
  it('derives a TB-only material residual candidate for family auto-mapping', () => {
    const candidates = deriveCompany7000CcProdMappingCandidates([
      row(1, 'TB', '61130002', '16470635', 'ADM PERSEDIAAN'),
    ]);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].coaCode, '61130002');
    assert.equal(candidates[0].total.toString(), '16470635');
    assert.equal(candidates[0].logicalSourceCode, 'CC_PROD');
  });

  it('uses TB - ADUM - PASAR for the ordinary residual', () => {
    const candidates = deriveCompany7000CcProdMappingCandidates([
      row(1, 'TB', '61130002', '100'),
      row(2, 'CC_ADUM', '61130002', '20'),
      row(3, 'CC_PASAR', '61130002', '30'),
    ]);
    assert.equal(candidates[0].total.toString(), '50');
  });

  it('ignores non account-group-6 TB rows', () => {
    const candidates = deriveCompany7000CcProdMappingCandidates([
      row(1, 'TB', '51300003', '100'),
    ]);
    assert.equal(candidates.length, 0);
  });
});
