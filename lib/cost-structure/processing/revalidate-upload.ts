import 'server-only';
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
