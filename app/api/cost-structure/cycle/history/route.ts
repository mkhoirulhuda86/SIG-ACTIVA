import { NextRequest, NextResponse } from "next/server";
import { requireCostStructureRead } from "@/lib/cost-structure/auth";
import { prisma } from "@/lib/prisma";
export async function GET(request: NextRequest) {
  const auth = await requireCostStructureRead(request);
  if ("error" in auth) return auth.error;
  const uploads = await prisma.costCycleUpload.findMany({
    include: {
      period: true,
      uploadedBy: { select: { name: true } },
      changeRuns: {
        include: {
          generatedBy: { select: { name: true } },
          changes: true,
          files: true,
        },
        orderBy: { generatedAt: "desc" },
      },
    },
    orderBy: { uploadedAt: "desc" },
    take: 100,
  });
  return NextResponse.json({
    uploads: uploads.map((u) => ({
      ...u,
      fileSizeBytes: u.fileSizeBytes.toString(),
      storageKey: undefined,
      changeRuns: u.changeRuns.map((r) => ({
        ...r,
        changes: r.changes.map((c) => ({ ...c, id: c.id.toString() })),
      })),
    })),
  });
}
