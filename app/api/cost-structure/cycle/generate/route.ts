import { NextRequest, NextResponse } from "next/server";
import { requireCostStructurePrepare } from "@/lib/cost-structure/auth";
import {
  generateCycle,
  CycleWorkflowError,
} from "@/lib/cost-structure/cycle/workflow/service";
import type { CycleTargetChange } from "@/lib/cost-structure/cycle/contracts";

export async function POST(request: NextRequest) {
  const auth = await requireCostStructurePrepare(request);
  if ("error" in auth) return auth.error;
  const body = (await request.json().catch(() => null)) as {
    fiscalYear?: number;
    fiscalPeriod?: number;
    expectedUploadId?: number;
    expectedVersion?: number;
    expectedHash?: string;
    expectedMasterFingerprint?: string;
    targets?: CycleTargetChange[];
  } | null;
  if (
    !body ||
    !Number.isInteger(body.fiscalYear) ||
    !Number.isInteger(body.fiscalPeriod) ||
    !Number.isInteger(body.expectedUploadId) ||
    !Number.isInteger(body.expectedVersion) ||
    typeof body.expectedHash !== "string" ||
    typeof body.expectedMasterFingerprint !== "string" ||
    !Array.isArray(body.targets)
  )
    return NextResponse.json(
      { error: "Payload generation tidak valid." },
      { status: 400 },
    );
  try {
    const run = await generateCycle({
      ...body,
      fiscalYear: body.fiscalYear!,
      fiscalPeriod: body.fiscalPeriod!,
      expectedUploadId: body.expectedUploadId!,
      expectedVersion: body.expectedVersion!,
      expectedHash: body.expectedHash,
      expectedMasterFingerprint: body.expectedMasterFingerprint,
      targets: body.targets,
      userId: auth.user.uid,
    });
    return NextResponse.json(
      {
        runId: run.id,
        files: run.files.map((f) => ({
          id: f.id,
          cycle: f.cycle,
          fileName: f.fileName,
          rowCount: f.rowCount,
          downloadUrl: `/api/cost-structure/cycle/files/${f.id}`,
        })),
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Generation gagal.",
        code: error instanceof CycleWorkflowError ? error.code : undefined,
      },
      { status: error instanceof CycleWorkflowError ? error.status : 500 },
    );
  }
}
