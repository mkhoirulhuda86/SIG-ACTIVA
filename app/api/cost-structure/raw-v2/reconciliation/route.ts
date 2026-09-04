import { NextRequest, NextResponse } from 'next/server';
import { requireCostStructureRead } from '@/lib/cost-structure/auth';
import { prisma } from '@/lib/prisma';

const money = (value: { toString(): string } | null) => value?.toString() ?? null;

export async function GET(request: NextRequest) {
  const auth = await requireCostStructureRead(request);
  if ('error' in auth) return auth.error;

  const fiscalYear = Number(request.nextUrl.searchParams.get('fiscalYear'));
  const fiscalPeriod = Number(request.nextUrl.searchParams.get('fiscalPeriod'));
  if (!Number.isInteger(fiscalYear) || !Number.isInteger(fiscalPeriod)) {
    return NextResponse.json({ error: 'Fiscal year/period diperlukan.' }, { status: 400 });
  }

  const period = await prisma.costRawV2Period.findUnique({
    where: { companyCode_fiscalYear_fiscalPeriod: { companyCode: '2000', fiscalYear, fiscalPeriod } },
    include: { uploads: { where: { isActiveVersion: true }, include: { sources: true }, take: 1 } },
  });
  if (!period) return NextResponse.json({ period: null, upload: null, run: null });

  const upload = period.uploads[0] ?? null;
  const run = upload
    ? await prisma.costRawV2CalculationRun.findFirst({
        where: { periodId: period.id, uploadId: upload.id },
        orderBy: { startedAt: 'desc' },
        include: { reconciliation: { include: { rows: { where: { status: { not: 'MATCH' } }, orderBy: { coaCode: 'asc' } } } } },
      })
    : null;
  const rec = run?.reconciliation;

  return NextResponse.json({
    period: { id: period.id, status: period.status, companyCode: period.companyCode, fiscalYear, fiscalPeriod },
    upload: upload && {
      id: upload.id,
      version: upload.version,
      status: upload.status,
      sources: upload.sources.map((s) => ({
        logicalSourceCode: s.logicalSourceCode,
        presenceStatus: s.presenceStatus,
        detailRowCount: s.detailRowCount,
        nonZeroDetailRowCount: s.nonZeroDetailRowCount,
        detailTotal: money(s.detailTotal),
        debitControl: money(s.debitControl),
        reconciliationDifference: money(s.reconciliationDifference),
      })),
    },
    run: run && {
      id: run.id,
      runNumber: run.runNumber,
      status: run.status,
      isActive: run.isActive,
      ruleSetVersion: run.ruleSetVersion,
      reconciliation: rec && {
        ...rec,
        totalAdum: money(rec.totalAdum),
        totalPasar: money(rec.totalPasar),
        totalBaseCc: money(rec.totalBaseCc),
        totalTbPopulation: money(rec.totalTbPopulation),
        totalDifference: money(rec.totalDifference),
        derivTotal: money(rec.derivTotal),
        derivDebitControl: money(rec.derivDebitControl),
        derivSourceDifference: money(rec.derivSourceDifference),
        rows: rec.rows.map((row) => ({
          ...row,
          adumAmount: money(row.adumAmount),
          pasarAmount: money(row.pasarAmount),
          ccAmount: money(row.ccAmount),
          tbAmount: money(row.tbAmount),
          difference: money(row.difference),
        })),
      },
    },
  });
}
