import { NextRequest, NextResponse } from 'next/server';
import { requireCostStructureRead } from '@/lib/cost-structure/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const auth = await requireCostStructureRead(request);
  if ('error' in auth) return auth.error;

  const fiscalYear = Number(request.nextUrl.searchParams.get('fiscalYear'));
  const fiscalPeriod = Number(request.nextUrl.searchParams.get('fiscalPeriod'));
  if (!Number.isInteger(fiscalYear) || !Number.isInteger(fiscalPeriod) || fiscalPeriod < 1 || fiscalPeriod > 12) {
    return NextResponse.json({ error: 'Fiscal year/period diperlukan.' }, { status: 400 });
  }

  const period = await prisma.costRawV2Period.findUnique({
    where: { companyCode_fiscalYear_fiscalPeriod: { companyCode: '2000', fiscalYear, fiscalPeriod } },
  });
  if (!period) return NextResponse.json({ period: null, run: null });

  const activeUpload = await prisma.costRawV2Upload.findFirst({
    where: { periodId: period.id, isActiveVersion: true },
    select: { id: true },
  });
  if (!activeUpload) return NextResponse.json({ period, run: null });

  const run = await prisma.costRawV2CalculationRun.findFirst({
    where: {
      periodId: period.id,
      uploadId: activeUpload.id,
      mappingSnapshotJson: { path: ['stage'], equals: 'E_MAPPING_RINCIAN_SI' },
    },
    orderBy: { startedAt: 'desc' },
    include: {
      results: { orderBy: { resultCode: 'asc' } },
      controls: { orderBy: { controlCode: 'asc' } },
      analyticalRows: { orderBy: [{ logicalSourceCode: 'asc' }, { coaCode: 'asc' }] },
    },
  });

  return NextResponse.json({
    period,
    run: run && {
      ...run,
      results: run.results.map((result) => ({ ...result, amount: result.amount.toString() })),
      controls: run.controls.map((control) => ({
        ...control,
        sourceAmount: control.sourceAmount.toString(),
        accountedAmount: control.accountedAmount.toString(),
        difference: control.difference.toString(),
      })),
      analyticalRows: run.analyticalRows.map((row) => ({
        ...row,
        rawAmount: row.rawAmount.toString(),
        mappedAmount: row.mappedAmount.toString(),
      })),
    },
  });
}
