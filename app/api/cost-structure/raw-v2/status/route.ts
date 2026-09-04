import { NextRequest, NextResponse } from 'next/server';
import { requireCostStructureRead } from '@/lib/cost-structure/auth';
import { getRawV2Status } from '@/lib/cost-structure/raw-v2/status';

export async function GET(request: NextRequest) {
  const auth = await requireCostStructureRead(request);
  if ('error' in auth) return auth.error;
  return NextResponse.json(getRawV2Status());
}
