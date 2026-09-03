import 'server-only';
import { CostMappingAction, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { boundBeforeProtectedPeriod, overlapping, previousDay, validToBeforeNext } from './effective-mapping';
import { requireLockedCostGroupCode } from './source-cost-group-policy';
import { refreshPeriodReadiness, runPhaseD } from '../reconciliation/service';

export type ResolveMappingInput = {
  uploadId: number;
  logicalSourceCode: string;
  coaCodeRaw: string;
  mappingAction: 'INCLUDE' | 'EXCLUDE' | 'RECLASS';
  natureId?: number;
  note?: string;
  reason?: string;
};

const sources = new Set(['CC_PROD', 'CC_ADUM', 'CC_PASAR', 'CC_WHRPG']);

export async function resolveSourceMapping(input: ResolveMappingInput, userId: number) {
  if (!sources.has(input.logicalSourceCode) || !input.coaCodeRaw) throw new Error('Sumber/COA tidak valid.');
  const action = CostMappingAction[input.mappingAction];
  const reason = (input.reason || input.note || '').trim();
  if ((action === 'EXCLUDE' || action === 'RECLASS') && !reason) throw new Error('Alasan wajib diisi.');

  const result = await prisma.$transaction(async (tx) => {
    const upload = await tx.costUpload.findUnique({ where: { id: input.uploadId }, include: { period: true } });
    if (!upload || !upload.isActiveVersion) throw new Error('Upload aktif tidak ditemukan.');
    if (upload.period.status === 'FINALIZED') throw new Error('Periode FINALIZED dilindungi.');

    const rows = await tx.costSourceRow.findMany({
      where: { uploadId: upload.id, logicalSourceCode: input.logicalSourceCode, coaCodeRaw: input.coaCodeRaw },
    });
    if (!rows.length) throw new Error('Baris sumber tidak ditemukan.');

    let group = null;
    let nature = null;
    if (action !== 'EXCLUDE') {
      if (!input.natureId) throw new Error('Nature wajib dipilih. Cost Group ditentukan otomatis dari source.');
      const groupCode = requireLockedCostGroupCode(input.logicalSourceCode);
      group = await tx.costGroup.findFirst({
        where: { companyId: upload.period.companyId, code: groupCode, active: true },
      });
      if (!group) throw new Error(`MAPPING_TARGET_INVALID: Cost Group ${groupCode} aktif tidak ditemukan untuk company ini.`);
      nature = await tx.costNature.findFirst({
        where: { id: input.natureId, costGroupId: group.id, active: true, calculationType: 'MAPPED' },
      });
      if (!nature) {
        throw new Error(`MAPPING_TARGET_INVALID: Nature harus aktif, bertipe MAPPED, dan berada pada Cost Group ${groupCode}.`);
      }
    }

    const description = rows.find((row) => row.descriptionRaw)?.descriptionRaw?.trim() || input.coaCodeRaw;
    let coa = await tx.costCoa.findUnique({ where: { coaCode: input.coaCodeRaw } });
    const mismatch = Boolean(coa && coa.coaDescription !== description);
    if (!coa) coa = await tx.costCoa.create({ data: { coaCode: input.coaCodeRaw, coaDescription: description } });

    const effective = upload.period.periodStart;
    const existing = await tx.costCoaMapping.findMany({
      where: {
        companyId: upload.period.companyId,
        sourceLogicalCode: input.logicalSourceCode,
        coaId: coa.id,
        active: true,
      },
      orderBy: { validFrom: 'asc' },
    });

    if (overlapping(existing)) throw new Error('MAPPING_OVERLAP: interval mapping existing sudah saling overlap.');
    if (existing.some((item) => item.validFrom.getTime() === effective.getTime())) {
      throw new Error('MAPPING_OVERLAP: mapping pada tanggal efektif ini sudah ada.');
    }

    const candidateValidTo = validToBeforeNext(effective, existing);
    const firstFinalized = await tx.costPeriod.findFirst({
      where: {
        companyId: upload.period.companyId,
        status: 'FINALIZED',
        periodStart: {
          gt: effective,
          ...(candidateValidTo ? { lte: candidateValidTo } : {}),
        },
      },
      orderBy: { periodStart: 'asc' },
      select: { periodStart: true },
    });
    const validTo = boundBeforeProtectedPeriod(candidateValidTo, firstFinalized?.periodStart ?? null);

    const covering = existing.find(
      (item) => item.validFrom < effective && (item.validTo === null || item.validTo >= effective)
    );
    if (covering) {
      await tx.costCoaMapping.update({ where: { id: covering.id }, data: { validTo: previousDay(effective) } });
    }

    const mapping = await tx.costCoaMapping.create({
      data: {
        companyId: upload.period.companyId,
        sourceLogicalCode: input.logicalSourceCode,
        coaId: coa.id,
        costGroupId: group?.id,
        natureId: nature?.id,
        mappingAction: action,
        validFrom: effective,
        validTo,
        note: reason || null,
        createdById: userId,
      },
    });

    const mappingStatus = action === 'INCLUDE' ? 'MAPPED' : action === 'EXCLUDE' ? 'EXCLUDED' : 'RECLASSIFIED';
    await tx.costSourceRow.updateMany({
      where: { id: { in: rows.map((row) => row.id) } },
      data: { coaId: coa.id, mappingStatus },
    });
    await tx.costValidationIssue.updateMany({
      where: {
        uploadId: upload.id,
        issueCode: { in: ['UNMAPPED_COA', 'MAPPING_AMBIGUOUS', 'MAPPING_TARGET_INVALID'] },
        resolved: false,
        message: { startsWith: `[${input.logicalSourceCode}:${input.coaCodeRaw}]` },
      },
      data: {
        resolved: true,
        resolutionType: action,
        resolutionNote: reason || null,
        resolvedById: userId,
        resolvedAt: new Date(),
      },
    });

    if (mismatch) {
      const context = `[${input.logicalSourceCode}:${input.coaCodeRaw}]`;
      const existingMismatch = await tx.costValidationIssue.findFirst({
        where: { uploadId: upload.id, issueCode: 'COA_DESCRIPTION_MISMATCH', resolved: false, message: { startsWith: context } },
      });
      if (!existingMismatch) {
        await tx.costValidationIssue.create({
          data: {
            uploadId: upload.id,
            issueCode: 'COA_DESCRIPTION_MISMATCH',
            severity: 'WARNING',
            message: `${context} Deskripsi master berbeda; master tidak ditimpa.`,
          },
        });
      }
    }

    await tx.costAuditLog.create({
      data: {
        userId,
        periodId: upload.periodId,
        action: action === 'EXCLUDE' ? 'EXCLUDE_COA' : action === 'RECLASS' ? 'RECLASS_COA' : 'RESOLVE_MAPPING',
        entityType: 'CostCoaMapping',
        entityId: String(mapping.id),
        newValueJson: {
          sourceLogicalCode: input.logicalSourceCode,
          coaCode: input.coaCodeRaw,
          costGroupId: group?.id ?? null,
          costGroupCode: group?.code ?? null,
          natureId: nature?.id ?? null,
          mappingAction: action,
          validFrom: effective.toISOString(),
          validTo: validTo?.toISOString() ?? null,
          protectedFinalizedPeriodStart: firstFinalized?.periodStart.toISOString() ?? null,
        } as Prisma.InputJsonValue,
        reason: reason || null,
      },
    });

    return {
      mappingId: mapping.id,
      affectedRows: rows.length,
      totalAmount: rows.reduce((sum, row) => sum.add(row.amount ?? 0), new Prisma.Decimal(0)).toString(),
      descriptionMismatch: mismatch,
    };
  });

  await runPhaseD(input.uploadId);
  await refreshPeriodReadiness(input.uploadId);
  return result;
}
