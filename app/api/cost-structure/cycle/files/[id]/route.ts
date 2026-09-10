import { NextRequest, NextResponse } from "next/server";
import { requireCostStructureRead } from "@/lib/cost-structure/auth";
import { prisma } from "@/lib/prisma";
import { costStructureStorage } from "@/lib/cost-structure/storage/supabase-storage";
import { XLSX_CONTENT_TYPE } from "@/lib/cost-structure/cycle/export";
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireCostStructureRead(request);
  if ("error" in auth) return auth.error;
  const id = Number((await context.params).id);
  const file = Number.isInteger(id)
    ? await prisma.costCycleGeneratedFile.findUnique({ where: { id } })
    : null;
  if (!file)
    return NextResponse.json(
      { error: "File tidak ditemukan." },
      { status: 404 },
    );
  const bytes = await costStructureStorage.download(file.storageKey);
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "content-type": XLSX_CONTENT_TYPE,
      "content-disposition": `attachment; filename="${file.fileName.replace(/["\r\n]/g, "")}"`,
      "cache-control": "private, no-store",
    },
  });
}
