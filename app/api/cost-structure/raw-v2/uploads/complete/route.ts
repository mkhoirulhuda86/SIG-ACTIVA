import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireCostStructurePrepare } from "@/lib/cost-structure/auth";
import { prisma } from "@/lib/prisma";
import { costStructureStorage } from "@/lib/cost-structure/storage/supabase-storage";
import { parseRawV2Workbook } from "@/lib/cost-structure/raw-v2/parsers";
import { verifyRawV2PendingUpload } from "@/lib/cost-structure/raw-v2/uploads";
import {
  completeRawV2Upload,
  RawV2CompletionError,
  RawV2DuplicateUploadError,
} from "@/lib/cost-structure/raw-v2/completion-service";

export async function POST(request: NextRequest) {
  const auth = await requireCostStructurePrepare(request);
  if ("error" in auth) return auth.error;
  const body = (await request.json().catch(() => null)) as {
    uploadContext?: string;
  } | null;
  const pending = body?.uploadContext
    ? verifyRawV2PendingUpload(body.uploadContext)
    : null;
  if (!pending || pending.userId !== auth.user.uid)
    return NextResponse.json(
      { error: "Konteks upload Raw V2 tidak valid atau kedaluwarsa." },
      { status: 400 },
    );
  try {
    const existingPeriod = await prisma.costRawV2Period.findUnique({
      where: {
        companyCode_fiscalYear_fiscalPeriod: {
          companyCode: pending.companyCode,
          fiscalYear: pending.fiscalYear,
          fiscalPeriod: pending.fiscalPeriod,
        },
      },
    });
    const completed = await completeRawV2Upload(
      {
        objectKey: pending.objectKey,
        expectedSize: pending.fileSize,
        context: {
          companyCode: pending.companyCode,
          fiscalYear: pending.fiscalYear,
          fiscalPeriod: pending.fiscalPeriod,
        },
      },
      {
        download: (key) => costStructureStorage.download(key),
        remove: (key) => costStructureStorage.remove(key),
        findDuplicate: (hash) =>
          existingPeriod
            ? prisma.costRawV2Upload.findUnique({
                where: {
                  periodId_fileHashSha256: {
                    periodId: existingPeriod.id,
                    fileHashSha256: hash,
                  },
                },
                select: {
                  id: true,
                  version: true,
                  status: true,
                  isActiveVersion: true,
                  storageKey: true,
                },
              })
            : Promise.resolve(null),
        parse: parseRawV2Workbook,
        persist: async ({ hash, bytes, parsed }) =>
          prisma.$transaction(
            async (tx) => {
              const hasErrors = parsed.issues.some(
                (issue) => issue.severity === "ERROR",
              );
              const period = await tx.costRawV2Period.upsert({
                where: {
                  companyCode_fiscalYear_fiscalPeriod: {
                    companyCode: pending.companyCode,
                    fiscalYear: pending.fiscalYear,
                    fiscalPeriod: pending.fiscalPeriod,
                  },
                },
                create: {
                  companyCode: pending.companyCode,
                  fiscalYear: pending.fiscalYear,
                  fiscalPeriod: pending.fiscalPeriod,
                },
                update: {},
              });
              const latest = await tx.costRawV2Upload.aggregate({
                where: { periodId: period.id },
                _max: { version: true },
              });
              const upload = await tx.costRawV2Upload.create({
                data: {
                  periodId: period.id,
                  version: (latest._max.version || 0) + 1,
                  originalFileName: pending.fileName,
                  fileHashSha256: hash,
                  fileSizeBytes: BigInt(bytes.byteLength),
                  storageProvider: "SUPABASE_STORAGE",
                  storageKey: pending.objectKey,
                  status: hasErrors ? "INVALID" : "VALIDATED",
                  isActiveVersion: false,
                  uploadedById: auth.user.uid,
                  validatedAt: new Date(),
                },
              });
              const uniqueSources = [
                ...new Map(
                  parsed.sources.map((source) => [
                    source.logicalSourceCode,
                    source,
                  ]),
                ).values(),
              ];
              if (uniqueSources.length)
                await tx.costRawV2Source.createMany({
                  data: uniqueSources.map((source) => ({
                    uploadId: upload.id,
                    logicalSourceCode: source.logicalSourceCode,
                    originalSheetName: source.originalSheetName,
                    presenceStatus: source.presenceStatus,
                    companyCode: source.companyCode,
                    fiscalYear: source.fiscalYear,
                    fiscalPeriod: source.fiscalPeriod,
                    controllingArea: source.controllingArea,
                    costCenterGroup: source.costCenterGroup,
                    headerRowNumber: source.headerRowNumber,
                    detailRowCount: source.detailRowCount,
                    nonZeroDetailRowCount: source.nonZeroDetailRowCount,
                    detailTotal: source.detailTotal
                      ? new Prisma.Decimal(source.detailTotal)
                      : null,
                    debitControl: source.debitControl
                      ? new Prisma.Decimal(source.debitControl)
                      : null,
                    overUnderControl: source.overUnderControl
                      ? new Prisma.Decimal(source.overUnderControl)
                      : null,
                    reconciliationDifference: source.reconciliationDifference
                      ? new Prisma.Decimal(source.reconciliationDifference)
                      : null,
                    metadataJson: source.metadataJson ?? undefined,
                  })),
                });
              for (let offset = 0; offset < parsed.rows.length; offset += 500)
                await tx.costRawV2SourceRow.createMany({
                  data: parsed.rows
                    .slice(offset, offset + 500)
                    .map((row) => ({
                      uploadId: upload.id,
                      logicalSourceCode: row.logicalSourceCode,
                      originalSheetName: row.originalSheetName,
                      sourceRowNumber: row.sourceRowNumber,
                      rawDataJson: row.rawDataJson,
                      normalizedDataJson: row.normalizedDataJson,
                      coaCodeRaw: row.coaCodeRaw,
                      descriptionRaw: row.descriptionRaw,
                      amount: row.amount
                        ? new Prisma.Decimal(row.amount)
                        : null,
                      normalizationStatus: row.normalizationStatus,
                    })),
                });
              if (parsed.issues.length)
                await tx.costRawV2ValidationIssue.createMany({
                  data: parsed.issues.map((issue) => ({
                    uploadId: upload.id,
                    issueCode: issue.issueCode,
                    severity: issue.severity,
                    message: issue.message,
                  })),
                });
              if (!hasErrors) {
                await tx.costRawV2Upload.updateMany({
                  where: { periodId: period.id, isActiveVersion: true },
                  data: {
                    isActiveVersion: false,
                    status: "SUPERSEDED",
                    supersededAt: new Date(),
                  },
                });
                await tx.costRawV2Upload.update({
                  where: { id: upload.id },
                  data: { isActiveVersion: true },
                });
                await tx.costRawV2Period.update({
                  where: { id: period.id },
                  data: { status: "VALIDATED" },
                });
              }
              return upload;
            },
            { timeout: 60_000 },
          ),
      },
    );
    return NextResponse.json({
      success: true,
      upload: {
        id: completed.result.id,
        version: completed.result.version,
        status: completed.result.status,
        isActiveVersion: !completed.parsed.issues.some(
          (i) => i.severity === "ERROR",
        ),
        hash: completed.hash,
        rowCount: completed.parsed.rows.length,
        sources: completed.parsed.sources,
        issues: completed.parsed.issues,
      },
    });
  } catch (error) {
    if (error instanceof RawV2DuplicateUploadError)
      return NextResponse.json(
        { error: error.message, existingUpload: error.existingUpload },
        { status: 409 },
      );
    if (error instanceof RawV2CompletionError) {
      console.error("Raw V2 completion failed", error);
      return NextResponse.json(
        { error: error.message, errorCode: `RAW_V2_${error.stage}_FAILED` },
        {
          status:
            error.stage === "PARSE" || error.stage === "SIZE_VERIFY"
              ? 422
              : 500,
        },
      );
    }
    console.error("Raw V2 completion failed", error);
    return NextResponse.json(
      { error: "Gagal memproses workbook Raw V2." },
      { status: 500 },
    );
  }
}
