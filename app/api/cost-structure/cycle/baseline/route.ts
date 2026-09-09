import { NextRequest, NextResponse } from "next/server";
import { requireCostStructureRead } from "@/lib/cost-structure/auth";
import {
  loadActiveCycle,
  CycleWorkflowError,
} from "@/lib/cost-structure/cycle/workflow/service";
import { deriveReceiverBaselines } from "@/lib/cost-structure/cycle/engine";

export async function GET(request: NextRequest) {
  const auth = await requireCostStructureRead(request);
  if ("error" in auth) return auth.error;
  const fiscalYear = Number(request.nextUrl.searchParams.get("fiscalYear")),
    fiscalPeriod = Number(request.nextUrl.searchParams.get("fiscalPeriod"));
  try {
    const state = await loadActiveCycle(fiscalYear, fiscalPeriod);
    const refs = new Map(state.references.map((r) => [r.receiverCc, r]));
    return NextResponse.json({
      upload: {
        id: state.upload.id,
        version: state.upload.version,
        hash: state.upload.fileHashSha256,
        originalFileName: state.upload.originalFileName,
        status: state.upload.status,
        isActiveVersion: state.upload.isActiveVersion,
        uploadedAt: state.upload.uploadedAt,
        totalRowCount: state.upload.totalRowCount,
        fixedRowCount: state.upload.fixedRowCount,
        variableRowCount: state.upload.variableRowCount,
        uniqueReceiverCcCount: state.upload.uniqueReceiverCcCount,
        errorCount: state.upload.errorCount,
        warningCount: state.upload.warningCount,
        sourceSheet: state.sourceSheetName,
      },
      masterFingerprint: state.fingerprint,
      receivers: deriveReceiverBaselines(state.rows, state.ccMaster).map(
        (b) => ({
          ...b,
          receiverDescription: state.ccMaster.find(
            (m) => m.receiverCc === b.receiverCc,
          )?.receiverDescription,
          reference: refs.get(b.receiverCc),
        }),
      ),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Gagal memuat baseline.",
      },
      { status: error instanceof CycleWorkflowError ? error.status : 500 },
    );
  }
}
