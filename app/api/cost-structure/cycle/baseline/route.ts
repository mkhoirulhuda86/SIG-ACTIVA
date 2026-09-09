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

  const fiscalYear = Number(request.nextUrl.searchParams.get("fiscalYear"));
  const fiscalPeriod = Number(request.nextUrl.searchParams.get("fiscalPeriod"));

  try {
    const state = await loadActiveCycle(fiscalYear, fiscalPeriod);
    const references = new Map(
      state.references.map((reference) => [reference.receiverCc, reference]),
    );
    const masterByCc = new Map(
      state.ccMaster.map((master) => [master.receiverCc, master]),
    );
    const baselines = deriveReceiverBaselines(state.rows, state.ccMaster);

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
      receivers: baselines.map((baseline) => ({
        ...baseline,
        receiverDescription:
          masterByCc.get(baseline.receiverCc)?.receiverDescription,
        reference: references.get(baseline.receiverCc),
      })),
      referenceCandidates: baselines
        .filter((baseline) => baseline.baselineStatus === "ON")
        .map((baseline) => ({
          receiverCc: baseline.receiverCc,
          receiverDescription:
            masterByCc.get(baseline.receiverCc)?.receiverDescription ?? "",
          plantCode: baseline.plantCode,
          plantName: baseline.plantName,
          processLabel: baseline.processLabel,
        })),
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
