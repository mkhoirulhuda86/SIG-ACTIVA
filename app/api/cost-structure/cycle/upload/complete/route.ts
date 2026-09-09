import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireCostStructurePrepare } from '@/lib/cost-structure/auth';
import { prisma } from '@/lib/prisma';
import { parseCycleWorkbook, validateCycleReceivers } from '@/lib/cost-structure/cycle/parser';
import { activeCycleReceiverCcs, DuplicateCycleUploadError, persistCycleUpload } from '@/lib/cost-structure/cycle/repository/upload-repository';
import { costStructureStorage } from '@/lib/cost-structure/storage/supabase-storage';
import { verifyCycleUpload } from '@/lib/cost-structure/cycle/storage/upload-policy';

export async function POST(request: NextRequest) {
  const auth = await requireCostStructurePrepare(request); if ('error' in auth) return auth.error;
  const body = await request.json().catch(() => null) as { uploadContext?: string } | null;
  const pending = body?.uploadContext ? verifyCycleUpload(body.uploadContext) : null;
  if (!pending || pending.userId !== auth.user.uid) return NextResponse.json({ error: 'Konteks upload tidak valid atau kedaluwarsa.' }, { status: 400 });
  let bytes: Uint8Array;
  try {
    bytes = await costStructureStorage.download(pending.objectKey);
    if (bytes.byteLength !== pending.fileSize) throw new Error('stored size mismatch');
  } catch (error) {
    console.error('Cycle source download failed', error);
    return NextResponse.json({ error: 'Workbook tersimpan tidak tersedia atau ukurannya berubah.' }, { status: 422 });
  }
  const hash = createHash('sha256').update(bytes).digest('hex');
  try {
    const parsed = validateCycleReceivers(parseCycleWorkbook(bytes), await activeCycleReceiverCcs(prisma));
    const upload = await persistCycleUpload(prisma, {
      fiscalYear: pending.fiscalYear, fiscalPeriod: pending.fiscalPeriod, fileName: pending.fileName,
      storageKey: pending.objectKey, hash, bytes, parsed, uploadedById: auth.user.uid,
    });
    const valid = parsed.summary.errorCount === 0;
    return NextResponse.json({ success: valid, upload: {
      id: upload.id, version: upload.version, status: upload.status, hash, isActiveVersion: upload.isActiveVersion,
      sheetName: parsed.sheetName, summary: parsed.summary, issues: parsed.issues.slice(0, 100),
    } }, { status: valid ? 201 : 422 });
  } catch (error) {
    if (error instanceof DuplicateCycleUploadError) {
      await costStructureStorage.remove(pending.objectKey).catch(() => undefined);
      return NextResponse.json({ error: error.message, existingUpload: error.existing }, { status: 409 });
    }
    console.error('Cycle upload completion failed', error);
    return NextResponse.json({ error: 'Gagal memproses workbook; versi sebelumnya tetap aktif.' }, { status: 500 });
  }
}
