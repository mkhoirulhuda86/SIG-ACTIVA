import { createHmac, timingSafeEqual } from 'node:crypto';

export const MAX_CYCLE_WORKBOOK_BYTES = 50 * 1024 * 1024;
export const CYCLE_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroenabled.12',
]);

export type PendingCycleUpload = {
  fiscalYear: number; fiscalPeriod: number; fileName: string; mimeType: string; fileSize: number;
  objectKey: string; userId: number; expiresAt: number;
};

export function sanitizeCycleFileName(name: string) {
  return (name.split(/[\\/]/).pop() || 'cycle.xlsx').normalize('NFKC').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(-180);
}

export function validateCycleFile(name: string, mimeType: string, size: number) {
  if (!/\.(xlsx|xlsm)$/i.test(sanitizeCycleFileName(name))) return 'Workbook harus berformat .xlsx atau .xlsm.';
  if (!CYCLE_MIME_TYPES.has(mimeType.toLowerCase())) return 'Tipe MIME workbook tidak didukung.';
  if (!Number.isSafeInteger(size) || size <= 0) return 'Ukuran workbook tidak valid.';
  if (size > MAX_CYCLE_WORKBOOK_BYTES) return 'Ukuran workbook melebihi batas 50 MB.';
  return null;
}

export function createCycleStorageKey(year: number, period: number, fileName: string, nonce: string) {
  return `cost-structure/cycle/${year}/${String(period).padStart(2, '0')}/${nonce.replace(/[^A-Za-z0-9-]/g, '')}-${sanitizeCycleFileName(fileName)}`;
}

function secret() { return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || ''; }
export function signCycleUpload(value: PendingCycleUpload) {
  if (!secret()) throw new Error('Upload signing secret is not configured');
  const body = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${body}.${createHmac('sha256', secret()).update(body).digest('base64url')}`;
}
export function verifyCycleUpload(token: string): PendingCycleUpload | null {
  const [body, signature] = token.split('.');
  if (!body || !signature || !secret()) return null;
  const expected = createHmac('sha256', secret()).update(body).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try { const value = JSON.parse(Buffer.from(body, 'base64url').toString()) as PendingCycleUpload; return value.expiresAt > Date.now() ? value : null; } catch { return null; }
}
