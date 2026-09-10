import { Prisma, type PrismaClient } from '@prisma/client';
import type { ParsedCycleWorkbook } from '../parser';
import { nextCycleUploadVersion, replacementStates } from './version-policy';

export class DuplicateCycleUploadError extends Error {
  constructor(public readonly existing: { id: number; version: number; status: string; uploadedAt: Date }) { super('Workbook yang sama sudah pernah diunggah untuk periode ini.'); }
}

export async function persistCycleUpload(prisma: PrismaClient, input: {
  fiscalYear: number; fiscalPeriod: number; fileName: string; hash: string; bytes: Uint8Array;
  storageKey: string; uploadedById: number; parsed: ParsedCycleWorkbook;
}) {
  return prisma.$transaction(async tx => {
    const period = await tx.costCyclePeriod.upsert({
      where: { fiscalYear_fiscalPeriod: { fiscalYear: input.fiscalYear, fiscalPeriod: input.fiscalPeriod } },
      create: { fiscalYear: input.fiscalYear, fiscalPeriod: input.fiscalPeriod, status: 'VALIDATING' }, update: { status: 'VALIDATING' },
    });
    const duplicate = await tx.costCycleUpload.findUnique({ where: { periodId_fileHashSha256: { periodId: period.id, fileHashSha256: input.hash } } });
    if (duplicate) throw new DuplicateCycleUploadError(duplicate);
    const latest = await tx.costCycleUpload.aggregate({ where: { periodId: period.id }, _max: { version: true } });
    const currentActive = await tx.costCycleUpload.findFirst({
      where: { periodId: period.id, isActiveVersion: true },
      select: { id: true, status: true },
    });
    const invalid = input.parsed.summary.errorCount > 0;
    const upload = await tx.costCycleUpload.create({ data: {
      periodId: period.id, version: nextCycleUploadVersion(latest._max.version == null ? [] : [latest._max.version]), originalFileName: input.fileName,
      fileHashSha256: input.hash, fileSizeBytes: BigInt(input.bytes.byteLength), storageProvider: 'SUPABASE_STORAGE', storageKey: input.storageKey,
      isActiveVersion: false, status: invalid ? 'INVALID' : 'VALIDATED', totalRowCount: input.parsed.summary.totalRows,
      fixedRowCount: input.parsed.summary.fixedRows, variableRowCount: input.parsed.summary.variableRows,
      uniqueReceiverCcCount: input.parsed.summary.uniqueReceiverCcs, errorCount: input.parsed.summary.errorCount,
      warningCount: input.parsed.summary.warningCount, uploadedById: input.uploadedById, validatedAt: new Date(),
    } });
    for (let offset = 0; offset < input.parsed.rows.length; offset += 500) await tx.costCycleSourceRow.createMany({ data: input.parsed.rows.slice(offset, offset + 500).map(row => ({
      uploadId: upload.id, sourceOrder: row.sourceOrder, sourceRowNumber: row.sourceRowNumber, sourceSheetName: input.parsed.sheetName!,
      cycle: row.cycle, startDate: new Date(`${row.startDate}T00:00:00.000Z`), segmentName: row.segmentName, receiverCc: row.receiverCc,
      portion: new Prisma.Decimal(String(row.portion)), rawDataJson: row.raw as Prisma.InputJsonValue,
    })) });
    for (let offset = 0; offset < input.parsed.issues.length; offset += 500) await tx.costCycleValidationIssue.createMany({ data: input.parsed.issues.slice(offset, offset + 500).map(issue => ({
      uploadId: upload.id, sourceRowNumber: issue.sourceRowNumber, issueCode: issue.code, severity: issue.severity,
      message: issue.message, metadataJson: issue.metadata as Prisma.InputJsonValue | undefined,
    })) });

    const replacement = replacementStates(currentActive, upload, !invalid);
    if (replacement.supersededId !== null) {
      await tx.costCycleUpload.update({
        where: { id: replacement.supersededId },
        data: { isActiveVersion: false, status: 'SUPERSEDED', supersededAt: new Date() },
      });
    }

    if (replacement.activeId === upload.id) {
      const active = await tx.costCycleUpload.update({ where: { id: upload.id }, data: { isActiveVersion: true } });
      await tx.costCyclePeriod.update({ where: { id: period.id }, data: { status: 'READY' } });
      return active;
    }

    await tx.costCyclePeriod.update({
      where: { id: period.id },
      data: { status: currentActive?.status === 'VALIDATED' ? 'READY' : 'INVALID' },
    });
    return upload;
  }, { timeout: 60_000 });
}

export async function activeCycleReceiverCcs(prisma: PrismaClient) {
  const masters = await prisma.costCycleCcMaster.findMany({ where: { active: true }, select: { receiverCc: true } });
  return new Set(masters.map(master => master.receiverCc));
}

export async function removeCycleUploadIfUnreferenced(dependencies: {
  findReference: () => Promise<{ id: number } | null>;
  remove: () => Promise<unknown>;
}) {
  // A failed lookup can mean the transaction committed but its acknowledgement
  // was lost. In that case fail closed and retain the object.
  const persisted = await dependencies.findReference().catch(() => undefined);
  if (persisted === null) await dependencies.remove().catch(() => undefined);
}
