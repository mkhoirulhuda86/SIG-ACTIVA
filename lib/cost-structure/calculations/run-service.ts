import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getPhaseDReport } from '@/lib/cost-structure/reconciliation/service';
import { isMappingBlockingAmount } from '@/lib/cost-structure/reconciliation/money';
import { backfillDeterministicFamilyMappings } from '@/lib/cost-structure/mappings/family-mapping-backfill';
import { classifySourceRow } from '@/lib/cost-structure/reconciliation/source-control-registry';
import { calculateCompany2000 } from './company-2000';
import { calculateCompany7000, COMPANY_7000_GROUPS, COMPANY_7000_MAPPED_SOURCES, ENGINE1_7000_RULE_SET_VERSION } from './company-7000';
import { buildCompany7000Input } from './company-7000-source-adapter';
import { COMPANY_2000_GROUPS, COMPANY_2000_SOURCES, ENGINE1_2000_RULE_SET_VERSION } from './constants';
import { assertContributingSupportCoasResolved, deriveCompany2000Support, parseCompany2000Derivative, parseCompany2000Rincian, sumSupportByCoa } from './company-2000-si-adapter';
import { buildMappingSnapshot } from './snapshot';
import type { ResolvedSourceLine } from './types';

const companySources = new Set<string>(COMPANY_2000_SOURCES);
const PERSIST_CHUNK_SIZE = 750;

export class CalculationConflictError extends Error {}

export async function runCostStructureCalculation(periodId: number, startedById: number) {
  const period = await prisma.costPeriod.findUnique({ where: { id: periodId }, select: { company: { select: { companyCode: true } } } });
  if (!period) throw new Error('Periode tidak ditemukan.');
  if (period.company.companyCode === '2000') return runCompany2000Calculation(periodId, startedById);
  if (period.company.companyCode === '7000') return runCompany7000Calculation(periodId, startedById);
  throw new Error(`Company ${period.company.companyCode} tidak didukung Engine 1.`);
}

export async function runCompany7000Calculation(periodId: number, startedById: number) {
  const period = await prisma.costPeriod.findUnique({ where: { id: periodId }, include: { company: true, uploads: { where: { isActiveVersion: true }, orderBy: { version: 'desc' }, take: 1 } } });
  if (!period) throw new Error('Periode tidak ditemukan.');
  if (period.company.companyCode !== '7000') throw new Error('Company 7000 calculation requires Company 7000.');
  if (period.status === 'FINALIZED') throw new Error('Periode FINALIZED tidak dapat dihitung ulang.');
  if (!['SOURCE_RECONCILED', 'CALCULATED'].includes(period.status)) throw new Error('Periode belum SOURCE_RECONCILED.');
  const upload = period.uploads[0];
  if (!upload?.isActiveVersion) throw new Error('Upload aktif untuk periode tidak ditemukan.');

  // Calculation can be retried long after Phase D was first reconciled. Re-run the
  // deterministic family backfill here so derived Company-7000 CC_PROD requirements
  // (for example a TB-only COA) are recovered before readiness and adapter resolution.
  await backfillDeterministicFamilyMappings(upload.id, startedById);

  const readiness = await getPhaseDReport(upload.id);
  if (!readiness?.ready) throw new Error(`Phase D readiness gagal: ${readiness?.blockers.join('; ') ?? 'upload tidak ditemukan'}`);

  let run: { id: number; runNumber: number };
  try {
    run = await prisma.$transaction(async (tx) => {
      if (await tx.costCalculationRun.findFirst({ where: { periodId, status: 'RUNNING' } })) throw new CalculationConflictError('Calculation lain sedang berjalan untuk periode ini.');
      const latest = await tx.costCalculationRun.aggregate({ where: { periodId }, _max: { runNumber: true } });
      return tx.costCalculationRun.create({
        data: {
          periodId, uploadId: upload.id, runNumber: (latest._max.runNumber ?? 0) + 1, status: 'RUNNING', isActive: false,
          ruleSetVersion: ENGINE1_7000_RULE_SET_VERSION, startedById,
          sourceSnapshotJson: { periodId, companyCode: '7000', fiscalYear: period.fiscalYear, fiscalPeriod: period.fiscalPeriod, uploadId: upload.id, uploadVersion: upload.version, uploadHash: upload.fileHashSha256, sourceRowCount: readiness.upload.sourceRows.length, reconciliationReady: readiness.ready, sourceControls: readiness.sources.map((source) => ({ logicalSourceCode: source.logicalSourceCode, status: source.status, difference: source.difference })) },
          mappingSnapshotJson: [],
        },
        select: { id: true, runNumber: true },
      });
    });
  } catch (error) {
    if (error instanceof CalculationConflictError || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw new CalculationConflictError('Calculation request bertabrakan; silakan coba lagi.');
    throw error;
  }

  try {
    const state = await prisma.costPeriod.findUniqueOrThrow({ where: { id: periodId }, include: {
      company: { include: { groups: { where: { active: true, code: { in: [...COMPANY_7000_GROUPS] } }, include: { natures: { orderBy: { displayOrder: 'asc' } } } } } },
      uploads: { where: { id: upload.id }, include: { sourceRows: { include: { coa: true }, orderBy: { id: 'asc' } } }, take: 1 },
      adjustments: { include: { costGroup: true, nature: true }, orderBy: { id: 'asc' } },
    } });
    const currentUpload = state.uploads[0];
    if (!currentUpload?.isActiveVersion) throw new Error('Upload menjadi superseded sebelum calculation selesai.');
    const natures = state.company.groups.flatMap((group) => group.natures.map((nature) => ({ costGroupId: group.id, natureId: nature.id, groupCode: group.code as 'HPP' | 'ADUM' | 'PASAR', natureCode: nature.code, calculationType: nature.calculationType, ruleCode: nature.ruleCode, active: nature.active })));
    for (const group of COMPANY_7000_GROUPS) if (!state.company.groups.some((item) => item.code === group)) throw new Error(`Cost Group ${group} aktif tidak ditemukan untuk Company 7000.`);

    const sourceCoaCodes = [...new Set(currentUpload.sourceRows.flatMap((row) => {
      const code = row.coa?.coaCode ?? row.coaCodeRaw;
      return code && /^\d{8}$/.test(code) ? [code] : [];
    }))];
    const sourceCoas = sourceCoaCodes.length ? await prisma.costCoa.findMany({ where: { coaCode: { in: sourceCoaCodes } } }) : [];
    const coaIdByCode = new Map(sourceCoas.map((coa) => [coa.coaCode, coa.id]));
    const adapterRows = currentUpload.sourceRows.map((row) => {
      const coaCode = row.coa?.coaCode ?? row.coaCodeRaw;
      return {
        id: row.id,
        uploadId: currentUpload.id,
        uploadVersion: currentUpload.version,
        logicalSourceCode: row.logicalSourceCode,
        sourceRowNumber: row.sourceRowNumber,
        coaId: row.coaId ?? (coaCode ? coaIdByCode.get(coaCode) ?? null : null),
        coaCode,
        description: row.descriptionRaw,
        amount: row.amount,
        rawData: row.rawDataJson,
      };
    });
    const coaIds = [...new Set(adapterRows.flatMap((row) => row.coaId ? [row.coaId] : []))];
    const mappings = await prisma.costCoaMapping.findMany({ where: { companyId: state.companyId, sourceLogicalCode: { in: [...COMPANY_7000_MAPPED_SOURCES] }, coaId: { in: coaIds }, active: true, validFrom: { lte: state.periodStart }, OR: [{ validTo: null }, { validTo: { gte: state.periodStart } }] }, include: { costGroup: true, nature: true }, orderBy: { id: 'asc' } });
    const adapted = buildCompany7000Input({
      companyCode: '7000',
      fiscalPeriod: state.fiscalPeriod,
      natures,
      rows: adapterRows,
      mappings: mappings.map((mapping) => ({
        id: mapping.id, sourceLogicalCode: mapping.sourceLogicalCode, coaId: mapping.coaId, mappingAction: mapping.mappingAction,
        costGroupId: mapping.costGroupId, natureId: mapping.natureId, groupCode: mapping.costGroup?.code ?? null, natureCode: mapping.nature?.code ?? null,
        targetActive: Boolean(mapping.costGroup?.active && mapping.nature?.active && mapping.costGroup.companyId === state.companyId && mapping.nature.costGroupId === mapping.costGroupId),
        natureCalculationType: mapping.nature?.calculationType ?? null,
      })),
    });
    adapted.adjustments = state.adjustments.map((item) => ({
      adjustmentId: item.id,
      costGroupId: item.costGroupId,
      groupCode: item.costGroup.code,
      natureId: item.natureId,
      natureCode: item.nature.code,
      coaId: item.coaId,
      amount: item.amount,
      reason: item.reason,
      reference: item.reference,
      targetActive: item.costGroup.active && item.nature.active && item.costGroup.companyId === state.companyId && item.nature.costGroupId === item.costGroupId,
      natureCalculationType: item.nature.calculationType,
    }));

    const result = calculateCompany7000(adapted);
    const snapshot = buildMappingSnapshot(mappings.map((mapping) => ({ mappingId: mapping.id, companyId: mapping.companyId, sourceLogicalCode: mapping.sourceLogicalCode, coaId: mapping.coaId, mappingAction: mapping.mappingAction, costGroupId: mapping.costGroupId, natureId: mapping.natureId, validFrom: mapping.validFrom, validTo: mapping.validTo, updatedAt: mapping.updatedAt })));
    const groupIds = new Map(state.company.groups.map((group) => [group.code, group.id]));

    await prisma.$transaction(async (tx) => {
      const livePeriod = await tx.costPeriod.findUnique({ where: { id: periodId }, select: { status: true } });
      if (!livePeriod || livePeriod.status === 'FINALIZED') throw new Error('Periode tidak lagi eligible untuk calculation.');
      if (!(await tx.costUpload.findUnique({ where: { id: upload.id }, select: { isActiveVersion: true } }))?.isActiveVersion) throw new Error('Upload menjadi superseded sebelum aktivasi run.');
      await tx.costCalculationRun.update({ where: { id: run.id }, data: { mappingSnapshotJson: snapshot } });
      const lines = result.actualLines.map((line) => ({ calculationRunId: run.id, periodId, costGroupId: line.costGroupId, natureId: line.natureId, coaId: line.coaId, lineType: line.lineType, sourceAmount: line.sourceAmount, adjustmentAmount: line.adjustmentAmount, finalAmount: line.finalAmount, ruleCode: line.ruleCode, sourceRowId: line.sourceRowId, sourceReferenceJson: line.sourceReference as Prisma.InputJsonValue }));
      for (let offset = 0; offset < lines.length; offset += PERSIST_CHUNK_SIZE) await tx.costActualLine.createMany({ data: lines.slice(offset, offset + PERSIST_CHUNK_SIZE) });
      await tx.costCalculationResult.createMany({ data: [
        ...result.natureTotals.map((item) => ({ calculationRunId: run.id, periodId, costGroupId: item.costGroupId, natureId: item.natureId, resultCode: 'NATURE_TOTAL', resultType: 'NATURE' as const, amount: item.amount, ruleCode: natures.find((nature) => nature.natureId === item.natureId)?.ruleCode, calculationDetailJson: { natureCode: item.natureCode } as Prisma.InputJsonValue })),
        ...COMPANY_7000_GROUPS.map((code) => ({ calculationRunId: run.id, periodId, costGroupId: groupIds.get(code)!, natureId: null, resultCode: `TOTAL_${code}`, resultType: 'TOTAL' as const, amount: result.groupTotals[code], ruleCode: code === 'HPP' ? 'HPP_TOTAL_7000' : null, calculationDetailJson: (code === 'HPP' ? { accountGroup5: adapted.formulaDependencies.accountGroup5Total.sourceReference, cogsMortar: adapted.formulaDependencies.cogsMortar.sourceReference } : {}) as Prisma.InputJsonValue })),
        { calculationRunId: run.id, periodId, costGroupId: null, natureId: null, resultCode: 'TOTAL_COMPANY', resultType: 'TOTAL' as const, amount: result.companyTotal },
        ...result.controls.map((control) => ({ calculationRunId: run.id, periodId, costGroupId: control.costGroupId, natureId: null, resultCode: control.resultCode, resultType: 'CONTROL' as const, amount: control.amount, reconciliationDifference: control.difference, reconciliationStatus: isMappingBlockingAmount(control.difference.toString()) ? 'NOT_RECONCILED' : 'RECONCILED', calculationDetailJson: { natureSum: control.amount.sub(control.difference).toString() } as Prisma.InputJsonValue })),
      ] });
      await tx.costCalculationRun.updateMany({ where: { periodId, isActive: true }, data: { isActive: false } });
      await tx.costCalculationRun.update({ where: { id: run.id }, data: { status: 'SUCCESS', isActive: true, completedAt: new Date() } });
      await tx.costPeriod.update({ where: { id: periodId }, data: { activeCalculationRunId: run.id, status: 'CALCULATED' } });
    });
    return { runId: run.id, runNumber: run.runNumber, result };
  } catch (error) {
    await prisma.costCalculationRun.update({ where: { id: run.id }, data: { status: 'FAILED', isActive: false, completedAt: new Date(), errorMessage: error instanceof Error ? error.message.slice(0, 1000) : 'Calculation failed.' } }).catch(() => undefined);
    throw error;
  }
}

export async function runCompany2000Calculation(periodId: number, startedById: number) {
  const period = await prisma.costPeriod.findUnique({
    where: { id: periodId },
    include: { company: true, uploads: { where: { isActiveVersion: true }, orderBy: { version: 'desc' }, take: 1 } },
  });
  if (!period) throw new Error('Periode tidak ditemukan.');
  if (period.company.companyCode !== '2000') throw new Error('Phase E hanya mendukung Company 2000.');
  if (period.status === 'FINALIZED') throw new Error('Periode FINALIZED tidak dapat dihitung ulang.');
  if (!['SOURCE_RECONCILED', 'CALCULATED'].includes(period.status)) throw new Error('Periode belum SOURCE_RECONCILED.');
  const upload = period.uploads[0];
  if (!upload || upload.periodId !== period.id || !upload.isActiveVersion) throw new Error('Upload aktif untuk periode tidak ditemukan.');
  const readiness = await getPhaseDReport(upload.id);
  if (!readiness?.ready) throw new Error(`Phase D readiness gagal: ${readiness?.blockers.join('; ') ?? 'upload tidak ditemukan'}`);

  let run: { id: number; runNumber: number };
  try {
    run = await prisma.$transaction(async (tx) => {
      const running = await tx.costCalculationRun.findFirst({ where: { periodId, status: 'RUNNING' } });
      if (running) throw new CalculationConflictError('Calculation lain sedang berjalan untuk periode ini.');
      const latest = await tx.costCalculationRun.aggregate({ where: { periodId }, _max: { runNumber: true } });
      return tx.costCalculationRun.create({ data: {
        periodId, uploadId: upload.id, runNumber: (latest._max.runNumber ?? 0) + 1, status: 'RUNNING', isActive: false,
        ruleSetVersion: ENGINE1_2000_RULE_SET_VERSION, startedById,
        sourceSnapshotJson: { periodId, companyCode: period.company.companyCode, fiscalYear: period.fiscalYear, fiscalPeriod: period.fiscalPeriod, uploadId: upload.id, uploadVersion: upload.version, uploadHash: upload.fileHashSha256, sourceRowCount: readiness.upload.sourceRows.length, reconciliationReady: readiness.ready, sourceControls: readiness.sources.map((source) => ({ logicalSourceCode: source.logicalSourceCode, status: source.status, difference: source.difference })) },
        mappingSnapshotJson: [],
      }, select: { id: true, runNumber: true } });
    });
  } catch (error) {
    if (error instanceof CalculationConflictError || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw new CalculationConflictError('Calculation request bertabrakan; silakan coba lagi.');
    throw error;
  }

  try {
    const state = await prisma.costPeriod.findUniqueOrThrow({ where: { id: periodId }, include: {
      company: { include: { groups: { where: { active: true, code: { in: [...COMPANY_2000_GROUPS] } }, select: { id: true, code: true } } } },
      uploads: { where: { id: upload.id }, include: { sourceRows: { include: { coa: true }, orderBy: { id: 'asc' } } }, take: 1 },
      adjustments: { include: { costGroup: true, nature: true }, orderBy: { id: 'asc' } },
    } });
    const currentUpload = state.uploads[0];
    if (!currentUpload?.isActiveVersion) throw new Error('Upload menjadi superseded sebelum calculation selesai.');
    const groupIdByCode = new Map(state.company.groups.map((group) => [group.code, group.id]));
    for (const groupCode of COMPANY_2000_GROUPS) if (!groupIdByCode.has(groupCode)) throw new Error(`Cost Group ${groupCode} aktif tidak ditemukan untuk Company 2000.`);

    const candidates = currentUpload.sourceRows.filter((row) => companySources.has(row.logicalSourceCode) && classifySourceRow({ coaCodeRaw: row.coaCodeRaw, descriptionRaw: row.descriptionRaw, amount: row.amount?.toString() ?? null }).kind === 'DETAIL');
    const supportRows = currentUpload.sourceRows.map((row) => ({ id: row.id, logicalSourceCode: row.logicalSourceCode, sourceRowNumber: row.sourceRowNumber, rawData: row.rawDataJson }));
    const rincian = parseCompany2000Rincian(supportRows);
    const derivative = parseCompany2000Derivative(supportRows);
    const rawByGroup = { ADUM: sumSupportByCoa(candidates.filter((row) => row.logicalSourceCode === 'CC_ADUM').map((row) => ({ sourceRowId: row.id, sourceRowNumber: row.sourceRowNumber, coaCode: row.coa?.coaCode ?? row.coaCodeRaw ?? '', amount: row.amount ?? new Prisma.Decimal(0) }))), PASAR: sumSupportByCoa(candidates.filter((row) => row.logicalSourceCode === 'CC_PASAR').map((row) => ({ sourceRowId: row.id, sourceRowNumber: row.sourceRowNumber, coaCode: row.coa?.coaCode ?? row.coaCodeRaw ?? '', amount: row.amount ?? new Prisma.Decimal(0) }))) };
    const support = deriveCompany2000Support({ rincian, derivative, rawByGroup });
    const supportCoas = support.contributingCoaCodes.length ? await prisma.costCoa.findMany({ where: { coaCode: { in: support.contributingCoaCodes }, active: true } }) : [];
    const supportCoaByCode = new Map(supportCoas.map((coa) => [coa.coaCode, coa]));
    assertContributingSupportCoasResolved(support.contributingCoaCodes, supportCoaByCode.keys());
    const coaIds = [...new Set([...candidates.flatMap((row) => row.coaId ? [row.coaId] : []), ...supportCoas.map((coa) => coa.id)])];
    const mappings = await prisma.costCoaMapping.findMany({ where: { companyId: state.companyId, sourceLogicalCode: { in: [...COMPANY_2000_SOURCES] }, coaId: { in: coaIds }, active: true, validFrom: { lte: state.periodStart }, OR: [{ validTo: null }, { validTo: { gte: state.periodStart } }] }, include: { costGroup: true, nature: true }, orderBy: { id: 'asc' } });
    const byKey = new Map<string, typeof mappings>();
    for (const mapping of mappings) { const key = `${mapping.sourceLogicalCode}:${mapping.coaId}`; byKey.set(key, [...(byKey.get(key) ?? []), mapping]); }
    // Equal explicitly excluded base/derivative evidence (for example Product Development) remains
    // in the full CC_DRV detail control, but is removed consistently from the analytical SI basis.
    const analyticalControls = { ...support.controls };
    for (const groupCode of COMPANY_2000_GROUPS) {
      const sourceCode = groupCode === 'ADUM' ? 'CC_ADUM' : 'CC_PASAR';
      for (const item of rincian[groupCode]) {
        const coa = supportCoaByCode.get(item.coaCode);
        if (coa && byKey.get(`${sourceCode}:${coa.id}`)?.[0]?.mappingAction === 'EXCLUDE') {
          if (groupCode === 'ADUM') analyticalControls.rincianAdumTotal = analyticalControls.rincianAdumTotal.sub(item.amount);
          else analyticalControls.rincianPasarTotal = analyticalControls.rincianPasarTotal.sub(item.amount);
        }
      }
    }
    analyticalControls.derivativeSiTotal = derivative.details.reduce((total, item) => {
      const coa = supportCoaByCode.get(item.coaCode);
      return coa && byKey.get(`CC_PASAR:${coa.id}`)?.[0]?.mappingAction === 'EXCLUDE' ? total : total.add(item.amount);
    }, new Prisma.Decimal(0));
    const resolved: ResolvedSourceLine[] = candidates.map((row) => {
      const applicable = row.coaId ? byKey.get(`${row.logicalSourceCode}:${row.coaId}`) ?? [] : [];
      const mapping = applicable[0];
      const amount = row.amount ?? new Prisma.Decimal(0);
      if (!row.coaId && !amount.isZero()) throw new Error(`Source row ${row.id} has no CostCoa.`);
      const disposition = !mapping ? 'UNMAPPED' : mapping.mappingAction === 'EXCLUDE' ? 'EXCLUDED' : mapping.mappingAction === 'RECLASS' ? 'RECLASSIFIED' : 'MAPPED';
      return { sourceRowId: row.id, uploadId: currentUpload.id, uploadVersion: currentUpload.version, logicalSourceCode: row.logicalSourceCode, sourceRowNumber: row.sourceRowNumber, coaId: row.coaId ?? 0, coaCode: row.coa?.coaCode ?? row.coaCodeRaw ?? '', amount, disposition, applicableMappingCount: applicable.length, mappingId: mapping?.id, mappingAction: mapping?.mappingAction, costGroupId: mapping?.costGroupId ?? undefined, groupCode: mapping?.costGroup?.code, natureId: mapping?.natureId ?? undefined, natureCode: mapping?.nature?.code, targetActive: Boolean(mapping?.costGroup?.active && mapping?.nature?.active && mapping.costGroup.companyId === state.companyId && mapping.nature.costGroupId === mapping.costGroupId), natureCalculationType: mapping?.nature?.calculationType };
    });
    const supportLines: ResolvedSourceLine[] = [];
    for (const item of support.rincianDeltas) {
        const { groupCode, coaCode } = item;
        const coa = supportCoaByCode.get(coaCode)!;
        const applicable = byKey.get(`${groupCode === 'ADUM' ? 'CC_ADUM' : 'CC_PASAR'}:${coa.id}`) ?? [];
        const mapping = applicable[0];
        if (mapping?.mappingAction === 'EXCLUDE') continue;
        supportLines.push({ sourceRowId: item.sourceRowId, uploadId: currentUpload.id, uploadVersion: currentUpload.version, logicalSourceCode: 'AUDIT_RINCIAN', sourceRowNumber: item.sourceRowNumber, coaId: coa.id, coaCode, amount: item.amount, disposition: mapping ? 'MAPPED' : 'UNMAPPED', applicableMappingCount: applicable.length, mappingId: mapping?.id, mappingAction: mapping?.mappingAction, costGroupId: mapping?.costGroupId ?? undefined, groupCode: mapping?.costGroup?.code, natureId: mapping?.natureId ?? undefined, natureCode: mapping?.nature?.code, targetActive: Boolean(mapping?.costGroup?.active && mapping?.nature?.active), natureCalculationType: mapping?.nature?.calculationType, ruleCode: `RINCIAN_DELTA_${groupCode}`, sourceReference: { rincianAmount: item.amount.add(item.rawAmount).toString(), ccAmount: item.rawAmount.toString() } });
    }
    for (const item of support.derivativeDetails) {
      const coa = supportCoaByCode.get(item.coaCode)!;
      const applicable = byKey.get(`CC_PASAR:${coa.id}`) ?? [];
      const mapping = applicable[0];
      if (mapping?.mappingAction === 'EXCLUDE') continue;
      supportLines.push({ sourceRowId: item.sourceRowId, uploadId: currentUpload.id, uploadVersion: currentUpload.version, logicalSourceCode: 'AUDIT_CC_DRV', sourceRowNumber: item.sourceRowNumber, coaId: coa.id, coaCode: item.coaCode, amount: item.amount.negated(), disposition: mapping ? 'MAPPED' : 'UNMAPPED', applicableMappingCount: applicable.length, mappingId: mapping?.id, mappingAction: mapping?.mappingAction, costGroupId: mapping?.costGroupId ?? undefined, groupCode: mapping?.costGroup?.code, natureId: mapping?.natureId ?? undefined, natureCode: mapping?.nature?.code, targetActive: Boolean(mapping?.costGroup?.active && mapping?.nature?.active), natureCalculationType: mapping?.nature?.calculationType, ruleCode: 'CC_DRV_DERIVATIVE_OFFSET' });
    }
    const allResolved = [...resolved, ...supportLines];
    const result = calculateCompany2000({ sourceLines: allResolved, supportControl: analyticalControls, adjustments: state.adjustments.map((item) => ({ adjustmentId: item.id, costGroupId: item.costGroupId, groupCode: item.costGroup.code, natureId: item.natureId, natureCode: item.nature.code, coaId: item.coaId, amount: item.amount, reason: item.reason, reference: item.reference, targetActive: item.costGroup.active && item.nature.active && item.costGroup.companyId === state.companyId && item.nature.costGroupId === item.costGroupId, natureCalculationType: item.nature.calculationType })) });
    const relevantMappingIds = new Set(allResolved.flatMap((line) => line.mappingId ? [line.mappingId] : []));
    const mappingSnapshot = buildMappingSnapshot(mappings.filter((mapping) => relevantMappingIds.has(mapping.id)).map((mapping) => ({ mappingId: mapping.id, companyId: mapping.companyId, sourceLogicalCode: mapping.sourceLogicalCode, coaId: mapping.coaId, mappingAction: mapping.mappingAction, costGroupId: mapping.costGroupId, natureId: mapping.natureId, validFrom: mapping.validFrom, validTo: mapping.validTo, updatedAt: mapping.updatedAt })));

    await prisma.$transaction(async (tx) => {
      const livePeriod = await tx.costPeriod.findUnique({ where: { id: periodId }, select: { status: true } });
      if (!livePeriod || livePeriod.status === 'FINALIZED') throw new Error('Periode tidak lagi eligible untuk calculation.');
      const liveUpload = await tx.costUpload.findUnique({ where: { id: upload.id }, select: { isActiveVersion: true } });
      if (!liveUpload?.isActiveVersion) throw new Error('Upload menjadi superseded sebelum aktivasi run.');
      await tx.costCalculationRun.update({ where: { id: run.id }, data: { mappingSnapshotJson: mappingSnapshot } });
      const actualLineData = result.actualLines.map((line) => ({ calculationRunId: run.id, periodId, costGroupId: line.costGroupId, natureId: line.natureId, coaId: line.coaId, lineType: line.lineType, sourceAmount: line.sourceAmount, adjustmentAmount: line.adjustmentAmount, finalAmount: line.finalAmount, ruleCode: line.ruleCode, sourceRowId: line.sourceRowId, sourceReferenceJson: line.sourceReference as Prisma.InputJsonValue }));
      for (let offset = 0; offset < actualLineData.length; offset += PERSIST_CHUNK_SIZE) await tx.costActualLine.createMany({ data: actualLineData.slice(offset, offset + PERSIST_CHUNK_SIZE) });
      await tx.costCalculationResult.createMany({ data: [
        ...result.natureTotals.map((item) => ({ calculationRunId: run.id, periodId, costGroupId: item.costGroupId, natureId: item.natureId, resultCode: 'NATURE_TOTAL', resultType: 'NATURE' as const, amount: item.amount })),
        ...COMPANY_2000_GROUPS.map((code) => ({ calculationRunId: run.id, periodId, costGroupId: groupIdByCode.get(code)!, natureId: null, resultCode: `TOTAL_${code}`, resultType: 'TOTAL' as const, amount: result.groupTotals[code] })),
        { calculationRunId: run.id, periodId, costGroupId: null, natureId: null, resultCode: 'TOTAL_COMPANY', resultType: 'TOTAL' as const, amount: result.companyTotal },
        ...result.controls.map((control) => ({ calculationRunId: run.id, periodId, costGroupId: control.costGroupId, natureId: null, resultCode: control.resultCode, resultType: 'CONTROL' as const, amount: control.amount, reconciliationDifference: control.difference, reconciliationStatus: isMappingBlockingAmount(control.difference.toString()) ? 'NOT_RECONCILED' : 'RECONCILED' })),
      ] });
      await tx.costCalculationRun.updateMany({ where: { periodId, isActive: true }, data: { isActive: false } });
      await tx.costCalculationRun.update({ where: { id: run.id }, data: { status: 'SUCCESS', isActive: true, completedAt: new Date() } });
      await tx.costPeriod.update({ where: { id: periodId }, data: { activeCalculationRunId: run.id, status: 'CALCULATED' } });
    });
    return { runId: run.id, runNumber: run.runNumber, result };
  } catch (error) {
    await prisma.costCalculationRun.update({ where: { id: run.id }, data: { status: 'FAILED', isActive: false, completedAt: new Date(), errorMessage: error instanceof Error ? error.message.slice(0, 1000) : 'Calculation failed.' } }).catch(() => undefined);
    throw error;
  }
}

export async function getCompany2000Calculation(periodId: number) {
  const period = await prisma.costPeriod.findUnique({
    where: { id: periodId },
    include: {
      company: true,
      uploads: { where: { isActiveVersion: true }, select: { id: true, version: true, status: true }, take: 1 },
      activeCalculationRun: { include: { results: { include: { costGroup: true, nature: true }, orderBy: [{ resultType: 'asc' }, { resultCode: 'asc' }] }, _count: { select: { actualLines: true } } } },
    },
  });
  if (!period) return null;
  const run = period.activeCalculationRun;
  const total = (code: string) => run?.results.find((item) => item.resultCode === code)?.amount.toString() ?? null;
  return { period: { id: period.id, companyCode: period.company.companyCode, fiscalYear: period.fiscalYear, fiscalPeriod: period.fiscalPeriod, status: period.status, activeUpload: period.uploads[0] ?? null }, activeRun: run ? { id: run.id, runNumber: run.runNumber, ruleSetVersion: run.ruleSetVersion, status: run.status, startedAt: run.startedAt, completedAt: run.completedAt, lineCount: run._count.actualLines, sourceSnapshot: run.sourceSnapshotJson, mappingSnapshot: run.mappingSnapshotJson } : null, totals: { HPP: total('TOTAL_HPP'), ADUM: total('TOTAL_ADUM'), PASAR: total('TOTAL_PASAR'), company: total('TOTAL_COMPANY') }, natureTotals: run?.results.filter((item) => item.resultType === 'NATURE').map((item) => ({ group: item.costGroup?.code, natureId: item.natureId, natureCode: item.nature?.code, natureName: item.nature?.name, calculationType: item.nature?.calculationType, ruleCode: item.nature?.ruleCode, amount: item.amount.toString() })) ?? [], controls: run?.results.filter((item) => item.resultType === 'CONTROL').map((item) => ({ resultCode: item.resultCode, amount: item.amount.toString(), difference: item.reconciliationDifference?.toString(), status: item.reconciliationStatus })) ?? [] };
}

export const getCostStructureCalculation = getCompany2000Calculation;
