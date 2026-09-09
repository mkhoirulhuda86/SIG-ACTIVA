import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireCostStructurePrepare } from '@/lib/cost-structure/auth';
import { costStructureStorage } from '@/lib/cost-structure/storage/supabase-storage';
import { createCycleStorageKey, sanitizeCycleFileName, signCycleUpload, validateCycleFile } from '@/lib/cost-structure/cycle/storage/upload-policy';

export async function POST(request: NextRequest) {
  const auth = await requireCostStructurePrepare(request); if ('error' in auth) return auth.error;
  const body = await request.json().catch(() => null) as { fiscalYear?: number; fiscalPeriod?: number; fileName?: string; mimeType?: string; fileSize?: number } | null;
  const fiscalYear = Number(body?.fiscalYear), fiscalPeriod = Number(body?.fiscalPeriod), fileSize = Number(body?.fileSize);
  const current = new Date().getUTCFullYear();
  if (!Number.isInteger(fiscalYear) || fiscalYear < current - 5 || fiscalYear > current + 2 || !Number.isInteger(fiscalPeriod) || fiscalPeriod < 1 || fiscalPeriod > 12) return NextResponse.json({ error: 'Tahun atau periode fiskal tidak valid.' }, { status: 400 });
  const fileName = sanitizeCycleFileName(body?.fileName ?? '');
  const fileError = validateCycleFile(fileName, body?.mimeType ?? '', fileSize);
  if (fileError) return NextResponse.json({ error: fileError }, { status: 400 });
  const objectKey = createCycleStorageKey(fiscalYear, fiscalPeriod, fileName, randomUUID());
  try {
    const signed = await costStructureStorage.createSignedUpload(objectKey);
    const uploadContext = signCycleUpload({ fiscalYear, fiscalPeriod, fileName, mimeType: body!.mimeType!, fileSize, objectKey, userId: auth.user.uid, expiresAt: Date.now() + 600_000 });
    return NextResponse.json({ ...signed, objectKey, uploadContext, expiresInSeconds: 600 });
  } catch (error) {
    console.error('Cycle upload init failed', error);
    return NextResponse.json({ error: 'Gagal membuat akses upload sementara.' }, { status: 500 });
  }
}
