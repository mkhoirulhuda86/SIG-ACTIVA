import { NextRequest, NextResponse } from 'next/server';
import { requireCostStructureRead } from '@/lib/cost-structure/auth';
import { getRawV2OperationalReport } from '@/lib/cost-structure/raw-v2/report-service';

const PRIVATE_NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest) {
  const auth = await requireCostStructureRead(request);
  if ('error' in auth) return auth.error;
  const fiscalYear = Number(request.nextUrl.searchParams.get('fiscalYear'));
  const fiscalPeriod = Number(request.nextUrl.searchParams.get('fiscalPeriod'));
  if (!Number.isInteger(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2200 || !Number.isInteger(fiscalPeriod) || fiscalPeriod < 1 || fiscalPeriod > 12) {
    return NextResponse.json({ error: 'Fiscal year/period diperlukan.' }, { status: 400, headers: PRIVATE_NO_STORE });
  }
  const report = await getRawV2OperationalReport(fiscalYear, fiscalPeriod);
  return NextResponse.json(
    report ?? { period: null, upload: null, stageD: null, run: null, issues: [], history: [], exportEligibility: { eligible: false, reasons: ['Period not found.'] } },
    { headers: PRIVATE_NO_STORE }
  );
}
