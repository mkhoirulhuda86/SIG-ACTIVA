from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if text.count(old) != 1:
        raise SystemExit(f'{path}: expected one match, got {text.count(old)}')
    p.write_text(text.replace(old, new, 1))

# 1) Parse authoritative SI totals (stored in thousands) and normalize to rupiah.
path = 'lib/cost-structure/calculations/company-2000-si-adapter.ts'
marker = """/**\n * Parses eight-digit CC_DRV details and reconciles them to the persisted Grand Total when the\n"""
insert = """export type Company2000SiTotals = {\n  adumTotal: Prisma.Decimal;\n  pasarTotal: Prisma.Decimal;\n};\n\n/** Parses the authoritative SI group totals and converts the workbook's thousand-rupiah unit to rupiah. */\nexport function parseCompany2000SiTotals(rows: PersistedSupportRow[]): Company2000SiTotals {\n  const ordered = rows.filter((row) => row.logicalSourceCode === 'AUDIT_SI').sort((a, b) => a.sourceRowNumber - b.sourceRowNumber);\n  let adumTotal: Prisma.Decimal | null = null;\n  let pasarTotal: Prisma.Decimal | null = null;\n\n  const assignUnique = (current: Prisma.Decimal | null, value: Prisma.Decimal, label: string) => {\n    if (current && !current.equals(value)) throw new Error(`AUDIT_SI contains conflicting ${label} totals.`);\n    return value;\n  };\n\n  for (const row of ordered) {\n    const label = normalized(cell(row, 1));\n    if (label !== 'TOTAL ADUM' && label !== 'TOTAL PERNIAGAAN' && label !== 'TOTAL PASAR') continue;\n    const rupiah = decimal(cell(row, 2), `AUDIT_SI row ${row.sourceRowNumber}`).mul(1000).toDecimalPlaces(2);\n    if (label === 'TOTAL ADUM') adumTotal = assignUnique(adumTotal, rupiah, 'ADUM');\n    else pasarTotal = assignUnique(pasarTotal, rupiah, 'PASAR');\n  }\n\n  if (!adumTotal) throw new Error('AUDIT_SI Total Adum was not found.');\n  if (!pasarTotal) throw new Error('AUDIT_SI Total Perniagaan/Pasar was not found.');\n  return { adumTotal, pasarTotal };\n}\n\n/**\n * Parses eight-digit CC_DRV details and reconciles them to the persisted Grand Total when the\n"""
replace_once(path, marker, insert)

# 2) Historical Company 2000 source-control policy: Debit is audit-only when Rincian and SI independently agree.
policy = r'''import { Prisma } from '@prisma/client';
import {
  parseCompany2000Rincian,
  parseCompany2000SiTotals,
  type PersistedSupportRow,
} from '../calculations/company-2000-si-adapter';
import { isMappingBlockingAmount } from './money';
import type { ReconciliationResult } from './types';

export type Company2000HistoricalSupportEvidence = {
  readyByGroup: { ADUM: boolean; PASAR: boolean };
  rincianTotals: { ADUM: Prisma.Decimal; PASAR: Prisma.Decimal } | null;
  siTotals: { ADUM: Prisma.Decimal; PASAR: Prisma.Decimal } | null;
  differences: { ADUM: Prisma.Decimal; PASAR: Prisma.Decimal } | null;
  error: string | null;
};

const zero = () => new Prisma.Decimal(0);

export function evaluateCompany2000HistoricalSupport(rows: PersistedSupportRow[]): Company2000HistoricalSupportEvidence {
  try {
    const rincian = parseCompany2000Rincian(rows);
    const si = parseCompany2000SiTotals(rows);
    const rincianTotals = {
      ADUM: rincian.ADUM.reduce((sum, item) => sum.add(item.amount), zero()),
      PASAR: rincian.PASAR.reduce((sum, item) => sum.add(item.amount), zero()),
    };
    const siTotals = { ADUM: si.adumTotal, PASAR: si.pasarTotal };
    const differences = {
      ADUM: rincianTotals.ADUM.sub(siTotals.ADUM),
      PASAR: rincianTotals.PASAR.sub(siTotals.PASAR),
    };
    return {
      readyByGroup: {
        ADUM: rincian.ADUM.length > 0 && !isMappingBlockingAmount(differences.ADUM.toString()),
        PASAR: rincian.PASAR.length > 0 && !isMappingBlockingAmount(differences.PASAR.toString()),
      },
      rincianTotals,
      siTotals,
      differences,
      error: null,
    };
  } catch (error) {
    return {
      readyByGroup: { ADUM: false, PASAR: false },
      rincianTotals: null,
      siTotals: null,
      differences: null,
      error: error instanceof Error ? error.message : 'Company 2000 historical support could not be evaluated.',
    };
  }
}

export function applyCompany2000HistoricalSourcePolicy(
  companyCode: string,
  logicalSourceCode: string,
  rawResult: ReconciliationResult,
  evidence: Company2000HistoricalSupportEvidence | null
): {
  result: ReconciliationResult;
  fallbackUsed: boolean;
  warningMessage: string | null;
} {
  const group = logicalSourceCode === 'CC_ADUM' ? 'ADUM' : logicalSourceCode === 'CC_PASAR' ? 'PASAR' : null;
  const fallbackEligible = companyCode === '2000'
    && group !== null
    && evidence?.readyByGroup[group]
    && (rawResult.status === 'NOT_RECONCILED' || rawResult.status === 'MISSING_TOTAL');

  if (!fallbackEligible || !group || !evidence?.rincianTotals || !evidence.siTotals || !evidence.differences) {
    return { result: rawResult, fallbackUsed: false, warningMessage: null };
  }

  const debitContext = rawResult.status === 'MISSING_TOTAL'
    ? 'Reported Debit tidak tersedia pada source.'
    : `Detail ${rawResult.detailAmount} tidak sama dengan reported Debit ${rawResult.reportedAmount}; selisih ${rawResult.difference}.`;
  const warningMessage = `${debitContext} Company 2000 historical control dialihkan ke RINCIAN/SI: RINCIAN ${evidence.rincianTotals[group].toString()}, SI ${evidence.siTotals[group].toString()}, selisih ${evidence.differences[group].toString()} (<= Rp1).`;

  return {
    result: { ...rawResult, status: 'RECONCILED', issueCode: null },
    fallbackUsed: true,
    warningMessage,
  };
}
'''
Path('lib/cost-structure/reconciliation/company-2000-source-control-policy.ts').write_text(policy)

# 3) Keep historical Debit warnings in the Phase-D synchronized issue family.
replace_once(
    'lib/cost-structure/reconciliation/issue-batch.ts',
    "export const SOURCE_CONTROL_CODES = ['CC_GROUP_TOTAL_NOT_FOUND', 'CC_GROUP_TOTAL_AMBIGUOUS', 'CC_GROUP_NOT_RECONCILED'] as const;",
    "export const SOURCE_CONTROL_CODES = ['CC_GROUP_TOTAL_NOT_FOUND', 'CC_GROUP_TOTAL_AMBIGUOUS', 'CC_GROUP_NOT_RECONCILED', 'CC_GROUP_DEBIT_AUDIT_WARNING'] as const;"
)

# 4) Apply the policy consistently in persisted Phase D and read-only readiness reports.
path = 'lib/cost-structure/reconciliation/service.ts'
replace_once(
    path,
    "import { isMappingBlockingAmount } from './money';\n",
    "import { isMappingBlockingAmount } from './money';\nimport { applyCompany2000HistoricalSourcePolicy, evaluateCompany2000HistoricalSupport } from './company-2000-source-control-policy';\n"
)
replace_once(
    path,
    """function setSourceIssue(\n  desired: DesiredIssueMap,\n  source: string,\n  code: string | null,\n  message: string | null\n) {\n""",
    """function setSourceIssue(\n  desired: DesiredIssueMap,\n  source: string,\n  code: string | null,\n  message: string | null,\n  severity: IssueSeverity = 'ERROR'\n) {\n"""
)
replace_once(
    path,
    """    severity: 'ERROR',\n    message: code && message ? `${context} ${message}` : null,\n""",
    """    severity,\n    message: code && message ? `${context} ${message}` : null,\n"""
)
replace_once(
    path,
    """    const results = [];\n    const desiredIssues: DesiredIssueMap = new Map();\n""",
    """    const historicalSupportEvidence = upload.period.company.companyCode === '2000'\n      ? evaluateCompany2000HistoricalSupport(upload.sourceRows.map((row) => ({\n          id: row.id,\n          logicalSourceCode: row.logicalSourceCode,\n          sourceRowNumber: row.sourceRowNumber,\n          rawData: row.rawDataJson,\n        })))\n      : null;\n    const results = [];\n    const desiredIssues: DesiredIssueMap = new Map();\n"""
)
replace_once(
    path,
    """      const result = reconcileCcGroup(rows.map((row) => ({\n        id: row.id,\n        coaCodeRaw: row.coaCodeRaw,\n        descriptionRaw: row.descriptionRaw,\n        amount: row.amount?.toString() ?? null,\n      })));\n      results.push({ logicalSourceCode: source, ...result });\n""",
    """      const rawResult = reconcileCcGroup(rows.map((row) => ({\n        id: row.id,\n        coaCodeRaw: row.coaCodeRaw,\n        descriptionRaw: row.descriptionRaw,\n        amount: row.amount?.toString() ?? null,\n      })));\n      const sourcePolicy = applyCompany2000HistoricalSourcePolicy(\n        upload.period.company.companyCode,\n        source,\n        rawResult,\n        historicalSupportEvidence\n      );\n      const result = sourcePolicy.result;\n      results.push({\n        logicalSourceCode: source,\n        ...result,\n        rawStatus: rawResult.status,\n        controlMode: sourcePolicy.fallbackUsed ? 'RINCIAN_SI' : 'DEBIT',\n      });\n"""
)
replace_once(
    path,
    """      const message = result.issueCode === 'CC_GROUP_TOTAL_NOT_FOUND'\n        ? 'Reported total unik tidak ditemukan.'\n        : result.issueCode === 'CC_GROUP_TOTAL_AMBIGUOUS'\n          ? 'Lebih dari satu kandidat reported total ditemukan.'\n          : result.issueCode\n            ? `Detail ${result.detailAmount} tidak sama dengan reported ${result.reportedAmount}; selisih ${result.difference}.`\n            : null;\n      setSourceIssue(desiredIssues, source, result.issueCode, message);\n""",
    """      const message = sourcePolicy.fallbackUsed\n        ? sourcePolicy.warningMessage\n        : result.issueCode === 'CC_GROUP_TOTAL_NOT_FOUND'\n          ? 'Reported total unik tidak ditemukan.'\n          : result.issueCode === 'CC_GROUP_TOTAL_AMBIGUOUS'\n            ? 'Lebih dari satu kandidat reported total ditemukan.'\n            : result.issueCode\n              ? `Detail ${result.detailAmount} tidak sama dengan reported ${result.reportedAmount}; selisih ${result.difference}.`\n              : null;\n      setSourceIssue(\n        desiredIssues,\n        source,\n        sourcePolicy.fallbackUsed ? 'CC_GROUP_DEBIT_AUDIT_WARNING' : result.issueCode,\n        message,\n        sourcePolicy.fallbackUsed ? 'WARNING' : 'ERROR'\n      );\n"""
)
replace_once(
    path,
    """  const requiredSources = required(upload.period.company.companyCode);\n  const sources = requiredSources.map((source) => ({\n    logicalSourceCode: source,\n    ...reconcileCcGroup(\n      upload.sourceRows\n        .filter((row) => row.logicalSourceCode === source)\n        .map((row) => ({\n          coaCodeRaw: row.coaCodeRaw,\n          descriptionRaw: row.descriptionRaw,\n          amount: row.amount?.toString() ?? null,\n        }))\n    ),\n  }));\n""",
    """  const requiredSources = required(upload.period.company.companyCode);\n  const historicalSupportEvidence = upload.period.company.companyCode === '2000'\n    ? evaluateCompany2000HistoricalSupport(upload.sourceRows.map((row) => ({\n        id: row.id,\n        logicalSourceCode: row.logicalSourceCode,\n        sourceRowNumber: row.sourceRowNumber,\n        rawData: row.rawDataJson,\n      })))\n    : null;\n  const sources = requiredSources.map((source) => {\n    const rawResult = reconcileCcGroup(\n      upload.sourceRows\n        .filter((row) => row.logicalSourceCode === source)\n        .map((row) => ({\n          coaCodeRaw: row.coaCodeRaw,\n          descriptionRaw: row.descriptionRaw,\n          amount: row.amount?.toString() ?? null,\n        }))\n    );\n    const sourcePolicy = applyCompany2000HistoricalSourcePolicy(\n      upload.period.company.companyCode,\n      source,\n      rawResult,\n      historicalSupportEvidence\n    );\n    return {\n      logicalSourceCode: source,\n      ...sourcePolicy.result,\n      rawStatus: rawResult.status,\n      controlMode: sourcePolicy.fallbackUsed ? 'RINCIAN_SI' : 'DEBIT',\n    };\n  });\n"""
)

# 5) A reusable revalidation service lets Process/Retry actually rerun the current parser.
revalidate = r'''import 'server-only';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { parseWorkbook } from '@/lib/cost-structure/parsers';
import { costStructureStorage } from '@/lib/cost-structure/storage/supabase-storage';

export async function revalidateCostUpload(uploadId: number, userId: number) {
  const upload = await prisma.costUpload.findUnique({
    where: { id: uploadId },
    include: {
      period: { include: { company: true } },
      calculationRuns: { select: { id: true }, take: 1 },
    },
  });
  if (!upload) throw new Error('Upload tidak ditemukan.');
  if (!upload.isActiveVersion) throw new Error('Hanya active upload version yang dapat direvalidasi.');
  if (upload.status !== 'VALIDATION_FAILED') throw new Error('Revalidation hanya berlaku untuk upload berstatus VALIDATION_FAILED.');
  if (upload.calculationRuns.length > 0) throw new Error('Upload yang sudah dipakai calculation run tidak dapat direvalidasi.');

  const bytes = await costStructureStorage.download(upload.storageKey);
  if (BigInt(bytes.byteLength) !== upload.fileSizeBytes) throw new Error('Ukuran file di Storage tidak sesuai dengan metadata upload.');
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== upload.fileHashSha256) throw new Error('SHA-256 file di Storage tidak sesuai dengan metadata upload.');

  const parsed = await parseWorkbook(bytes, upload.period.company.companyCode);
  const hasErrors = parsed.issues.some((issue) => issue.severity === 'ERROR');
  const nextStatus = hasErrors ? 'VALIDATION_FAILED' : 'VALIDATED';

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM cost_uploads WHERE id = ${uploadId} FOR UPDATE`;
    const current = await tx.costUpload.findUnique({
      where: { id: uploadId },
      include: { calculationRuns: { select: { id: true }, take: 1 } },
    });
    if (!current || !current.isActiveVersion || current.status !== 'VALIDATION_FAILED') throw new Error('UPLOAD_REVALIDATION_STATE_CHANGED');
    if (current.calculationRuns.length > 0) throw new Error('UPLOAD_REVALIDATION_HAS_RUN');

    await tx.costValidationIssue.deleteMany({ where: { uploadId } });
    await tx.costSourceRow.deleteMany({ where: { uploadId } });

    for (let offset = 0; offset < parsed.rows.length; offset += 500) {
      await tx.costSourceRow.createMany({
        data: parsed.rows.slice(offset, offset + 500).map((row) => ({
          ...row,
          uploadId,
          amount: row.amount ? new Prisma.Decimal(row.amount) : null,
          mappingStatus: row.logicalSourceCode.startsWith('AUDIT_') ? 'AUDIT_ONLY' : 'UNMAPPED',
          rawDataJson: row.rawDataJson,
        })),
      });
    }
    for (let offset = 0; offset < parsed.issues.length; offset += 500) {
      await tx.costValidationIssue.createMany({
        data: parsed.issues.slice(offset, offset + 500).map((issue) => ({
          uploadId,
          issueCode: issue.issueCode,
          severity: issue.severity,
          message: issue.message,
        })),
      });
    }

    await tx.costUpload.update({ where: { id: uploadId }, data: { status: nextStatus, validatedAt: new Date() } });
    await tx.costPeriod.update({ where: { id: upload.periodId }, data: { status: 'SOURCE_VALIDATION' } });
    await tx.costAuditLog.create({
      data: {
        userId,
        periodId: upload.periodId,
        action: 'REVALIDATE_COST_UPLOAD',
        entityType: 'CostUpload',
        entityId: String(uploadId),
        oldValueJson: { status: upload.status, fileHashSha256: upload.fileHashSha256 },
        newValueJson: { status: nextStatus, fileHashSha256: upload.fileHashSha256, issueCount: parsed.issues.length, rowCount: parsed.rows.length },
        reason: 'Revalidated existing immutable workbook bytes using the current Cost Structure parser/validation rules.',
      },
    });
  }, { timeout: 60_000 });

  return { status: nextStatus, issueCount: parsed.issues.length, rowCount: parsed.rows.length };
}
'''
Path('lib/cost-structure/processing/revalidate-upload.ts').write_text(revalidate)

# 6) Wire SOURCE_VALIDATION retry and trust persisted reconciliationStatus for Rp1 post-check parity.
path = 'lib/cost-structure/processing/service.ts'
replace_once(
    path,
    "import { runAutomaticCostStructureCalculation } from './automatic-calculation';\n",
    "import { runAutomaticCostStructureCalculation } from './automatic-calculation';\nimport { revalidateCostUpload } from './revalidate-upload';\n"
)
replace_once(
    path,
    """  const postCheckBlockers = activeRun?.status === 'SUCCESS'\n    ? activeRun.results.filter((control) => control.reconciliationStatus !== 'RECONCILED' || !control.reconciliationDifference?.isZero()).map((control) => ({ code: control.resultCode, message: `${control.resultCode} belum reconciled (difference ${control.reconciliationDifference?.toString() ?? 'N/A'}).` }))\n    : [];\n""",
    """  const postCheckBlockers = activeRun?.status === 'SUCCESS'\n    ? activeRun.results.filter((control) => control.reconciliationStatus !== 'RECONCILED').map((control) => ({ code: control.resultCode, message: `${control.resultCode} belum reconciled (difference ${control.reconciliationDifference?.toString() ?? 'N/A'}).` }))\n    : [];\n"""
)
replace_once(
    path,
    """type AdvanceDependencies = {\n  status(uploadId: number): Promise<CostStructureProcessStatus>;\n  reconcile(uploadId: number, userId: number): Promise<void>;\n""",
    """type AdvanceDependencies = {\n  status(uploadId: number): Promise<CostStructureProcessStatus>;\n  revalidate(uploadId: number, userId: number): Promise<void>;\n  reconcile(uploadId: number, userId: number): Promise<void>;\n"""
)
replace_once(
    path,
    """const dependencies: AdvanceDependencies = {\n  status: getCostStructureProcessStatus,\n  reconcile: async (uploadId, userId) => {\n""",
    """const dependencies: AdvanceDependencies = {\n  status: getCostStructureProcessStatus,\n  revalidate: async (uploadId, userId) => { await revalidateCostUpload(uploadId, userId); },\n  reconcile: async (uploadId, userId) => {\n"""
)
replace_once(
    path,
    """  return executeNextProcessStage(before, {\n    RECONCILIATION: () => deps.reconcile(uploadId, userId),\n""",
    """  return executeNextProcessStage(before, {\n    SOURCE_VALIDATION: () => deps.revalidate(uploadId, userId),\n    RECONCILIATION: () => deps.reconcile(uploadId, userId),\n"""
)

# 7) Regression tests based on the production 2025 Company-2000 layout and values.
policy_test = r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCompany2000HistoricalSupport, applyCompany2000HistoricalSourcePolicy } from './company-2000-source-control-policy';
import type { PersistedSupportRow } from '../calculations/company-2000-si-adapter';
import type { ReconciliationResult } from './types';

const row = (id: number, logicalSourceCode: string, sourceRowNumber: number, rawData: Record<string, unknown>): PersistedSupportRow => ({ id, logicalSourceCode, sourceRowNumber, rawData });

const historicalRows: PersistedSupportRow[] = [
  row(1, 'AUDIT_RINCIAN', 3, { COLUMN_2: 'G/L Acc', COLUMN_5: 'ADM', COLUMN_6: 'Pasar' }),
  row(2, 'AUDIT_RINCIAN', 4, { COLUMN_2: '61110001', COLUMN_5: '86285007530', COLUMN_6: '0' }),
  row(3, 'AUDIT_RINCIAN', 5, { COLUMN_2: '68340003', COLUMN_5: '0', COLUMN_6: '41249013135' }),
  row(4, 'AUDIT_SI', 29, { COLUMN_1: 'Total Adum', COLUMN_2: '86285007.53' }),
  row(5, 'AUDIT_SI', 41, { COLUMN_1: 'Total Perniagaan', COLUMN_2: '41249013.135000005' }),
];

const result = (status: ReconciliationResult['status']): ReconciliationResult => ({
  status,
  detailRowCount: 56,
  controlRowCount: status === 'MISSING_TOTAL' ? 0 : 2,
  detailAmount: '42145314491.00',
  reportedAmount: status === 'MISSING_TOTAL' ? null : '54759053633.00',
  difference: status === 'MISSING_TOTAL' ? null : '-12613739142.00',
  issueCode: status === 'MISSING_TOTAL' ? 'CC_GROUP_TOTAL_NOT_FOUND' : status === 'NOT_RECONCILED' ? 'CC_GROUP_NOT_RECONCILED' : status === 'AMBIGUOUS_TOTAL' ? 'CC_GROUP_TOTAL_AMBIGUOUS' : null,
});

test('production-style RINCIAN and SI totals validate the Company 2000 historical control fallback', () => {
  const evidence = evaluateCompany2000HistoricalSupport(historicalRows);
  assert.equal(evidence.readyByGroup.ADUM, true);
  assert.equal(evidence.readyByGroup.PASAR, true);
  assert.equal(evidence.rincianTotals?.PASAR.toString(), '41249013135');
  assert.equal(evidence.siTotals?.PASAR.toString(), '41249013135');
});

test('Company 2000 accepts mismatched or missing Debit only when RINCIAN and SI reconcile', () => {
  const evidence = evaluateCompany2000HistoricalSupport(historicalRows);
  for (const status of ['NOT_RECONCILED', 'MISSING_TOTAL'] as const) {
    const policy = applyCompany2000HistoricalSourcePolicy('2000', 'CC_PASAR', result(status), evidence);
    assert.equal(policy.fallbackUsed, true);
    assert.equal(policy.result.status, 'RECONCILED');
    assert.match(policy.warningMessage ?? '', /RINCIAN\/SI/);
  }
  const ambiguous = applyCompany2000HistoricalSourcePolicy('2000', 'CC_PASAR', result('AMBIGUOUS_TOTAL'), evidence);
  assert.equal(ambiguous.fallbackUsed, false);
  assert.equal(ambiguous.result.status, 'AMBIGUOUS_TOTAL');
});

test('SI mismatch above Rp1 keeps the source fail-closed', () => {
  const badRows = historicalRows.map((item) => item.id === 5 ? row(5, 'AUDIT_SI', 41, { COLUMN_1: 'Total Perniagaan', COLUMN_2: '41249013.137' }) : item);
  const evidence = evaluateCompany2000HistoricalSupport(badRows);
  assert.equal(evidence.readyByGroup.PASAR, false);
  const policy = applyCompany2000HistoricalSourcePolicy('2000', 'CC_PASAR', result('NOT_RECONCILED'), evidence);
  assert.equal(policy.fallbackUsed, false);
  assert.equal(policy.result.status, 'NOT_RECONCILED');
});

test('policy never changes Company 7000 source reconciliation', () => {
  const evidence = evaluateCompany2000HistoricalSupport(historicalRows);
  const policy = applyCompany2000HistoricalSourcePolicy('7000', 'CC_PASAR', result('NOT_RECONCILED'), evidence);
  assert.equal(policy.fallbackUsed, false);
});
'''
Path('lib/cost-structure/reconciliation/company-2000-source-control-policy.test.ts').write_text(policy_test)
