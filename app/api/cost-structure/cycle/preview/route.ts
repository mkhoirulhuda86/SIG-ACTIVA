import { NextRequest, NextResponse } from "next/server";
import { requireCostStructurePrepare } from "@/lib/cost-structure/auth";
import {
  previewCycle,
  CycleWorkflowError,
} from "@/lib/cost-structure/cycle/workflow/service";
import type { CycleTargetChange } from "@/lib/cost-structure/cycle/contracts";

export async function POST(request: NextRequest) {
  const auth = await requireCostStructurePrepare(request);
  if ("error" in auth) return auth.error;
  const body = (await request.json().catch(() => null)) as {
    fiscalYear?: number;
    fiscalPeriod?: number;
    targets?: CycleTargetChange[];
  } | null;
  if (
    !Number.isInteger(body?.fiscalYear) ||
    !Number.isInteger(body?.fiscalPeriod) ||
    !Array.isArray(body?.targets) ||
    body.targets.some(
      (t) =>
        !t ||
        typeof t.receiverCc !== "string" ||
        !["ON", "OFF"].includes(t.targetStatus),
    )
  )
    return NextResponse.json(
      { error: "Payload preview tidak valid." },
      { status: 400 },
    );
  try {
    const p = await previewCycle(body as Required<typeof body>);
    return NextResponse.json({
      upload: {
        id: p.state.upload.id,
        version: p.state.upload.version,
        hash: p.state.upload.fileHashSha256,
      },
      masterFingerprint: p.state.fingerprint,
      changes: p.changes,
      issues: p.result.issues,
      errors: p.result.issues.filter((i) => i.severity === "ERROR"),
      warnings: p.result.issues.filter((i) => i.severity === "WARNING"),
      generationBlocked: p.result.generationBlocked,
      totalChangedCcCount: p.changes.length,
      details: p.result.delta,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Preview gagal." },
      { status: error instanceof CycleWorkflowError ? error.status : 500 },
    );
  }
}
