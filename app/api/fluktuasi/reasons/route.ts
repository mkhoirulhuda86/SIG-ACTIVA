import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { broadcast } from '@/lib/sse';
import { requireFinanceRead, requireFinanceWrite } from '@/lib/api-auth';

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
} as const;

type ComparisonType = 'MOM' | 'YOY' | 'YTD';

type ReasonOverrideRow = {
  id: number;
  accountCode: string;
  comparisonType: ComparisonType;
  currentPeriod: string;
  comparisonPeriod: string;
  generatedReason: string;
  userComment: string;
  updatedById: number | null;
  updatedByName: string;
  createdAt: Date;
  updatedAt: Date;
};

const isPeriod = (value: string): boolean => /^\d{4}\.\d{2}$/.test(value);

const normalizeComparisonType = (value: unknown): ComparisonType | null => {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'MOM' || normalized === 'YOY' || normalized === 'YTD'
    ? normalized
    : null;
};

export async function GET(request: NextRequest) {
  try {
    const auth = await requireFinanceRead(request);
    if ('error' in auth) return auth.error;

    const rows = await prisma.$queryRaw<ReasonOverrideRow[]>`
      SELECT
        "id",
        "accountCode",
        "comparisonType",
        "currentPeriod",
        "comparisonPeriod",
        "generatedReason",
        "userComment",
        "updatedById",
        "updatedByName",
        "createdAt",
        "updatedAt"
      FROM "fluktuasi_reason_overrides"
      ORDER BY "updatedAt" ASC, "id" ASC
    `;

    return NextResponse.json(
      { success: true, data: rows },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error('Error fetching fluktuasi reason overrides:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil komentar final fluktuasi' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireFinanceWrite(request);
    if ('error' in auth) return auth.error;

    const body = await request.json();
    const accountCode = String(body?.accountCode ?? '').trim();
    const comparisonType = normalizeComparisonType(body?.comparisonType);
    const currentPeriod = String(body?.currentPeriod ?? '').trim();
    const comparisonPeriod = String(body?.comparisonPeriod ?? '').trim();
    const generatedReason = String(body?.generatedReason ?? '').slice(0, 20000);
    const userComment = String(body?.userComment ?? '').slice(0, 20000);

    if (!/^\d{5,}$/.test(accountCode)) {
      return NextResponse.json(
        { success: false, error: 'accountCode tidak valid' },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    if (!comparisonType) {
      return NextResponse.json(
        { success: false, error: 'comparisonType harus MOM, YOY, atau YTD' },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    if (!isPeriod(currentPeriod) || !isPeriod(comparisonPeriod)) {
      return NextResponse.json(
        { success: false, error: 'Periode harus menggunakan format YYYY.MM' },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const rows = await prisma.$queryRaw<ReasonOverrideRow[]>`
      INSERT INTO "fluktuasi_reason_overrides" (
        "accountCode",
        "comparisonType",
        "currentPeriod",
        "comparisonPeriod",
        "generatedReason",
        "userComment",
        "updatedById",
        "updatedByName",
        "createdAt",
        "updatedAt"
      ) VALUES (
        ${accountCode},
        ${comparisonType},
        ${currentPeriod},
        ${comparisonPeriod},
        ${generatedReason},
        ${userComment},
        ${auth.user.uid},
        ${auth.user.name},
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT ("accountCode", "comparisonType", "currentPeriod", "comparisonPeriod")
      DO UPDATE SET
        "generatedReason" = CASE
          WHEN EXCLUDED."generatedReason" <> '' THEN EXCLUDED."generatedReason"
          ELSE "fluktuasi_reason_overrides"."generatedReason"
        END,
        "userComment" = EXCLUDED."userComment",
        "updatedById" = EXCLUDED."updatedById",
        "updatedByName" = EXCLUDED."updatedByName",
        "updatedAt" = CURRENT_TIMESTAMP
      RETURNING
        "id",
        "accountCode",
        "comparisonType",
        "currentPeriod",
        "comparisonPeriod",
        "generatedReason",
        "userComment",
        "updatedById",
        "updatedByName",
        "createdAt",
        "updatedAt"
    `;

    broadcast('fluktuasi');

    return NextResponse.json(
      { success: true, data: rows[0] },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error('Error saving fluktuasi reason override:', error);
    return NextResponse.json(
      { success: false, error: 'Gagal menyimpan komentar final fluktuasi' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
