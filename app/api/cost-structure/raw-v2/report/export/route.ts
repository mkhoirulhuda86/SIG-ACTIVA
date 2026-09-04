import { NextRequest, NextResponse } from 'next/server';
import { requireCostStructureRead } from '@/lib/cost-structure/auth';
import { getRawV2OperationalReport } from '@/lib/cost-structure/raw-v2/report-service';
import { buildRawV2ReportWorkbook } from '@/lib/cost-structure/raw-v2/report-export';

export async function GET(request: NextRequest) {
  const auth = await requireCostStructureRead(request);
  if ('error' in auth) return auth.error;
  const fiscalYear = Number(request.nextUrl.searchParams.get('fiscalYear'));
  const fiscalPeriod = Number(request.nextUrl.searchParams.get('fiscalPeriod'));
  if (!Number.isInteger(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2200 || !Number.isInteger(fiscalPeriod) || fiscalPeriod < 1 || fiscalPeriod > 12) return NextResponse.json({ error: 'Fiscal year/period diperlukan.' }, { status: 400 });
  const report = await getRawV2OperationalReport(fiscalYear, fiscalPeriod);
  if (!report?.exportEligibility.eligible || !report.run || !report.upload) return NextResponse.json({ error: 'Export tidak tersedia.', reasons: report?.exportEligibility.reasons ?? ['Period not found.'] }, { status: 409 });
  const workbook = await buildRawV2ReportWorkbook(report);
  const bytes = await workbook.xlsx.writeBuffer();
  const filename = `SIG-ACTIVA_Raw-V2_2000_${fiscalYear}-P${String(fiscalPeriod).padStart(2, '0')}_Run-${report.run.runNumber}.xlsx`;
  return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'private, no-store' } });
}
