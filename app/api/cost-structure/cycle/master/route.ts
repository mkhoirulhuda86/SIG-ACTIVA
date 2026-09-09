import { NextRequest, NextResponse } from "next/server";
import {
  requireCostStructureAdmin,
  requireCostStructureRead,
} from "@/lib/cost-structure/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
export async function GET(request: NextRequest) {
  const auth = await requireCostStructureRead(request);
  if ("error" in auth) return auth.error;
  const [masters, references] = await Promise.all([
    prisma.costCycleCcMaster.findMany({
      orderBy: [{ plantCode: "asc" }, { displayOrder: "asc" }],
    }),
    prisma.costCycleReference.findMany(),
  ]);
  return NextResponse.json({ masters, references });
}
export async function PATCH(request: NextRequest) {
  const auth = await requireCostStructureAdmin(request);
  if ("error" in auth) return auth.error;
  const body = (await request.json().catch(() => null)) as {
    receiverCc?: string;
    preferredReferenceCc?: string | null;
    fallbackReferenceCcs?: string[];
    confidence?: string;
    reviewStatus?: "VALIDATED" | "PROPOSED" | "MANUAL_REQUIRED";
    active?: boolean;
  } | null;
  if (
    !body?.receiverCc ||
    !Array.isArray(body.fallbackReferenceCcs) ||
    !body.reviewStatus ||
    typeof body.confidence !== "string"
  )
    return NextResponse.json(
      { error: "Payload master tidak valid." },
      { status: 400 },
    );
  if (
    body.preferredReferenceCc === body.receiverCc ||
    body.fallbackReferenceCcs.includes(body.receiverCc)
  )
    return NextResponse.json(
      { error: "Reference tidak boleh sama dengan target." },
      { status: 400 },
    );
  const reference = await prisma.costCycleReference.update({
    where: { receiverCc: body.receiverCc },
    data: {
      preferredReferenceCc: body.preferredReferenceCc,
      fallbackReferenceCcs: body.fallbackReferenceCcs as Prisma.InputJsonValue,
      confidence: body.confidence,
      reviewStatus: body.reviewStatus,
      active: body.active,
      updatedById: auth.user.uid,
    },
  });
  return NextResponse.json({ reference });
}
